"""Optuna wrapper using the ask-and-tell interface for non-blocking optimization."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import logging
import math
from pathlib import Path
import re
from threading import Lock
import time
from typing import Any, Literal, TypeAlias, cast

import optuna
try:
    import optunahub  # pyright: ignore[reportMissingImports]
except Exception:  # pragma: no cover - optional dependency at runtime
    optunahub = None
from .models import (
    CategoricalParam,
    FloatParam,
    IntParam,
    WarmStartTrialSeed,
)
from optuna.storages import RDBStorage
from optuna.trial import FrozenTrial, TrialState

logger = logging.getLogger("optimizer")

# Silence Optuna's own logging (we control output ourselves)
optuna.logging.set_verbosity(optuna.logging.WARNING)

# SQLite storage directory
STORAGE_DIR = Path(__file__).parent / "data"
STORAGE_DIR.mkdir(exist_ok=True)
STORAGE_ROOT = STORAGE_DIR.resolve()

# SQLite lock timeout to reduce transient "database is locked" errors.
SQLITE_TIMEOUT_SECONDS = 30

# Avoid unbounded growth from buggy clients.
MAX_STUDY_TRIALS = 20000
MAX_WARM_START_SOURCE_STUDIES = 25
MAX_WARM_START_TRIALS_PER_SOURCE = 3000
MAX_WARM_START_IMPORTED_TRIALS = 8000
MAX_EXTERNAL_WARM_START_SEEDS = 4000
AUTO_SAMPLER_FALLBACK_SEED = 42

# Study identifier safety.
STUDY_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Cache the loaded OptunaHub module to avoid repeated network fetches.
_auto_sampler_module: Any | None = None
_AUTO_SAMPLER_LOCK = Lock()


@dataclass
class WarmStartImportResult:
    added_trials: int = 0
    skipped_incompatible: int = 0
    skipped_duplicate: int = 0


def _create_auto_sampler() -> optuna.samplers.BaseSampler:
    """Build an AutoSampler from OptunaHub with a deterministic TPE fallback."""
    global _auto_sampler_module
    if optunahub is None:
        logger.info(
            "optunahub is not installed; using deterministic TPE fallback for sampler='auto' (seed=%d).",
            AUTO_SAMPLER_FALLBACK_SEED,
        )
        return optuna.samplers.TPESampler(seed=AUTO_SAMPLER_FALLBACK_SEED)

    if _auto_sampler_module is not None:
        return _auto_sampler_module.AutoSampler()

    with _AUTO_SAMPLER_LOCK:
        if _auto_sampler_module is None:
            try:
                logger.info("Loading OptunaHub AutoSampler module")
                _auto_sampler_module = optunahub.load_module(
                    package="samplers/auto_sampler"
                )
            except Exception as exc:
                logger.warning(
                    "AutoSampler unavailable (%s); falling back to deterministic TPE (seed=%d).",
                    exc,
                    AUTO_SAMPLER_FALLBACK_SEED,
                )
                return optuna.samplers.TPESampler(seed=AUTO_SAMPLER_FALLBACK_SEED)
    assert _auto_sampler_module is not None
    return _auto_sampler_module.AutoSampler()


def _create_storage(storage_url: str) -> RDBStorage:
    """Create RDB storage with conservative SQLite timeout settings."""
    return RDBStorage(
        url=storage_url,
        engine_kwargs={"connect_args": {"timeout": SQLITE_TIMEOUT_SECONDS}},
    )


SamplerChoice: TypeAlias = Literal["auto", "tpe", "random", "gp", "qmc", "cmaes"]
RunMode: TypeAlias = Literal["resume", "fresh", "warm_start"]
SearchSpaceParamInput: TypeAlias = FloatParam | IntParam | CategoricalParam
ParamKey: TypeAlias = tuple[tuple[str, str], ...]


def _create_optional_sampler(
    *,
    sampler_label: str,
    factory: Callable[[], optuna.samplers.BaseSampler],
    missing_modules: set[str],
) -> optuna.samplers.BaseSampler:
    """Create sampler and fail clearly when optional dependencies are unavailable."""
    try:
        return factory()
    except ModuleNotFoundError as exc:
        if exc.name in missing_modules:
            missing = ", ".join(sorted(missing_modules))
            raise RuntimeError(
                f"{sampler_label} requires optional dependency module(s): {missing}."
            ) from exc
        raise


def _create_sampler(choice: SamplerChoice) -> optuna.samplers.BaseSampler:
    """Create sampler instance from user-selected option."""
    if choice == "auto":
        return _create_auto_sampler()
    if choice == "tpe":
        return optuna.samplers.TPESampler()
    if choice == "random":
        return optuna.samplers.RandomSampler()
    if choice == "gp":
        return _create_optional_sampler(
            sampler_label="GPSampler",
            factory=optuna.samplers.GPSampler,
            missing_modules={"scipy", "torch"},
        )
    if choice == "qmc":
        return optuna.samplers.QMCSampler()
    if choice == "cmaes":
        return _create_optional_sampler(
            sampler_label="CmaEsSampler",
            factory=lambda: optuna.samplers.CmaEsSampler(
                independent_sampler=optuna.samplers.TPESampler(),
            ),
            missing_modules={"cmaes"},
        )
    raise ValueError(f"Unsupported sampler choice: {choice}")


def _validate_study_name(study_name: str) -> str:
    if not STUDY_NAME_RE.fullmatch(study_name):
        raise ValueError(
            "Invalid study identifier. Use 1-64 chars: letters, numbers, '_' or '-'."
        )
    return study_name


def _storage_path_for_study(study_name: str) -> Path:
    safe_study_name = _validate_study_name(study_name)
    path = (STORAGE_DIR / f"{safe_study_name}.db").resolve()
    if STORAGE_ROOT != path.parent:
        raise ValueError("Invalid storage path for study.")
    return path


def _storage_url_for_study(study_name: str) -> str:
    # Use .as_posix() for SQLite URL — Windows backslash paths break SQLAlchemy URLs
    return f"sqlite:///{_storage_path_for_study(study_name).as_posix()}"


def _study_storage_paths(study_name: str) -> list[Path]:
    base = _storage_path_for_study(study_name)
    return [
        base,
        base.with_name(base.name + "-wal"),
        base.with_name(base.name + "-shm"),
        base.with_name(base.name + "-journal"),
    ]


def _dispose_storage_handles(storage: RDBStorage) -> None:
    """Best-effort cleanup of SQLAlchemy sessions/engine handles."""
    try:
        storage.remove_session()
    except Exception:
        logger.debug("Failed removing storage session", exc_info=True)

    engine = getattr(storage, "engine", None)
    if engine is not None:
        try:
            engine.dispose()
        except Exception:
            logger.debug("Failed disposing storage engine", exc_info=True)


def _remove_study_files(study_name: str, max_attempts: int = 8) -> bool:
    """Best-effort deletion of SQLite db and sidecar files."""
    candidates = [path for path in _study_storage_paths(study_name) if path.exists()]
    if not candidates:
        return True

    remaining = candidates
    for attempt in range(1, max_attempts + 1):
        next_remaining: list[Path] = []
        for path in remaining:
            try:
                path.unlink(missing_ok=True)
            except PermissionError:
                next_remaining.append(path)
            except OSError:
                next_remaining.append(path)

        if not next_remaining:
            logger.info("Removed SQLite files for study '%s'", study_name)
            return True

        # Windows file handles can linger briefly; back off and retry.
        sleep_s = min(0.05 * (2 ** (attempt - 1)), 0.8)
        time.sleep(sleep_s)
        remaining = [path for path in next_remaining if path.exists()]
        if not remaining:
            return True

    logger.warning(
        "Could not remove all SQLite files for study '%s' (still present: %s)",
        study_name,
        ", ".join(str(path.name) for path in remaining),
    )
    return False


def _load_completed_trials_if_exists(
    study_name: str,
) -> tuple[optuna.study.StudyDirection, list[FrozenTrial]] | None:
    storage_path = _storage_path_for_study(study_name)
    if not storage_path.exists():
        return None

    storage = _create_storage(_storage_url_for_study(study_name))
    try:
        try:
            study = optuna.load_study(study_name=study_name, storage=storage)
        except KeyError:
            return None
        direction = study.direction
        completed_trials = list(
            study.get_trials(
                deepcopy=False,
                states=(TrialState.COMPLETE,),
            )
        )
        return direction, completed_trials
    finally:
        _dispose_storage_handles(storage)


def _list_warm_start_source_candidates(
    study_family: str,
    current_study_name: str,
) -> list[str]:
    # Include both the canonical family study and all previous warm-start runs.
    # Sort newest-first so recency is favored when deduplicating identical params.
    candidates: list[tuple[float, str]] = []
    seen_studies: set[str] = set()

    paths_to_check = [_storage_path_for_study(study_family)]
    paths_to_check.extend(STORAGE_DIR.glob(f"{study_family}_warm_*.db"))
    for path in paths_to_check:
        study_name = path.stem
        if study_name == current_study_name or study_name in seen_studies:
            continue
        if not path.exists():
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        seen_studies.add(study_name)
        candidates.append((mtime, study_name))

    candidates.sort(reverse=True, key=lambda item: item[0])
    study_names = [study_name for _, study_name in candidates]
    if len(study_names) > MAX_WARM_START_SOURCE_STUDIES:
        logger.info(
            "Warm start source study list capped at %d (from %d candidates).",
            MAX_WARM_START_SOURCE_STUDIES,
            len(study_names),
        )
        study_names = study_names[:MAX_WARM_START_SOURCE_STUDIES]
    return study_names
class OptunaOptimizer:
    """Manages a single Optuna study with ask/tell interface."""

    def __init__(
        self,
        study_name: str,
        study_family: str | None,
        direction: str,
        sampler: SamplerChoice,
        run_mode: RunMode,
        search_space: list[SearchSpaceParamInput],
        warm_start_trials: list[WarmStartTrialSeed] | None = None,
    ) -> None:
        self.study_name = _validate_study_name(study_name)
        self.study_family = _validate_study_name(study_family or study_name)
        self.direction = direction
        self.sampler_choice = sampler
        self.run_mode = run_mode
        self._search_space = search_space
        self._base_distributions = self._build_distributions(search_space)

        if run_mode == "fresh":
            self.delete_study(self.study_name)

        storage = _create_storage(_storage_url_for_study(self.study_name))
        load_if_exists = run_mode == "resume"

        self.study = optuna.create_study(
            study_name=self.study_name,
            storage=storage,
            direction=direction,
            sampler=_create_sampler(sampler),
            load_if_exists=load_if_exists,
        )

        warm_started_trials = 0
        if run_mode == "warm_start":
            if warm_start_trials is not None:
                warm_started_trials = self._seed_from_external_trials(
                    warm_start_trials
                )
            else:
                warm_started_trials = self._seed_from_family_study()

        # Map trial_number -> frozen_trial for the ask/tell flow
        self._pending_trials: dict[int, optuna.trial.Trial] = {}
        self._trial_sampler_labels: dict[int, str] = {}

        logger.info(
            "Study '%s' initialized (mode=%s, direction=%s, existing_trials=%d, warm_started_trials=%d)",
            self.study_name,
            run_mode,
            direction,
            len(self.study.get_trials(deepcopy=False)),
            warm_started_trials,
        )
        logger.info(
            "Study '%s' family='%s' sampler option=%s (active=%s)",
            self.study_name,
            self.study_family,
            sampler,
            self.study.sampler.__class__.__name__,
        )

    @property
    def n_existing_trials(self) -> int:
        return len(self.study.get_trials(deepcopy=False))

    # ----------------------------------------------------------
    # Ask: generate next trial parameters
    # ----------------------------------------------------------

    def ask(
        self, search_space: list[SearchSpaceParamInput] | None = None
    ) -> tuple[int, dict[str, Any], str]:
        """Ask Optuna for the next set of parameters to evaluate.

        Returns (trial_number, params_dict, sampler_name).
        """
        current_trial_count = len(self.study.get_trials(deepcopy=False))
        if current_trial_count >= MAX_STUDY_TRIALS:
            raise RuntimeError(
                f"Study trial limit reached ({MAX_STUDY_TRIALS}). Refuse additional ask()."
            )

        space = search_space or self._search_space

        # Build Optuna distributions
        distributions = self._build_distributions(space)

        trial = self.study.ask(distributions)
        self._pending_trials[trial.number] = trial

        sampler_name = self._infer_sampler_label_for_trial_number(trial.number)
        self._trial_sampler_labels[trial.number] = sampler_name

        params = dict(trial.params)
        logger.info(
            "Trial %d suggested (sampler=%s): %s",
            trial.number,
            sampler_name,
            params,
        )
        return trial.number, params, sampler_name

    # ----------------------------------------------------------
    # Tell: report trial result back
    # ----------------------------------------------------------

    def tell(
        self,
        trial_number: int,
        value: float | None = None,
        state: str = "complete",
    ) -> dict[str, Any]:
        """Report the result of a trial.

        Returns summary dict with best_value, best_params, n_complete.
        """
        trial = self._pending_trials.pop(trial_number, None)
        sampler_name = self._trial_sampler_labels.pop(
            trial_number,
            self._infer_sampler_label_for_trial_number(trial_number),
        )

        optuna_state = {
            "complete": TrialState.COMPLETE,
            "pruned": TrialState.PRUNED,
            "fail": TrialState.FAIL,
        }.get(state, TrialState.FAIL)

        if optuna_state == TrialState.COMPLETE and value is None:
            raise ValueError("`value` is required when state='complete'.")

        # Trial not in pending happens after backend restart or duplicate tell.
        # Optuna's study.tell() accepts an int trial_number, looking it up from storage.
        trial_ref: optuna.trial.Trial | int = trial if trial is not None else trial_number

        tell_kwargs: dict[str, Any] = {
            "state": optuna_state,
            "skip_if_finished": True,
        }
        if optuna_state == TrialState.COMPLETE:
            # For single-objective studies, pass a scalar value.
            tell_kwargs["values"] = value

        self.study.tell(trial_ref, **tell_kwargs)

        best_value, best_params = self._current_best_snapshot()

        n_complete = len(
            self.study.get_trials(
                deepcopy=False,
                states=(TrialState.COMPLETE,),
            )
        )

        logger.info(
            "Trial %d reported (sampler=%s, state=%s, value=%s). Best: %s (n_complete=%d)",
            trial_number,
            sampler_name,
            state,
            value,
            best_value,
            n_complete,
        )

        return {
            "best_value": best_value,
            "best_params": best_params,
            "n_complete": n_complete,
        }

    # ----------------------------------------------------------
    # Status
    # ----------------------------------------------------------

    def status(self) -> dict[str, Any]:
        best_value, best_params = self._current_best_snapshot()
        return {
            "n_trials": len(self.study.get_trials(deepcopy=False)),
            "best_value": best_value,
            "best_params": best_params,
        }

    # ----------------------------------------------------------
    # Helpers
    # ----------------------------------------------------------

    def _seed_from_family_study(self) -> int:
        source_candidates = _list_warm_start_source_candidates(
            study_family=self.study_family,
            current_study_name=self.study_name,
        )
        if not source_candidates:
            logger.info(
                "Warm start source studies not found for family '%s'; starting cold.",
                self.study_family,
            )
            return 0

        # Deduplicate by parameter set across all imported studies.
        # This avoids overweighting repeated points when multiple prior runs
        # contain the same sampled parameters.
        seen_param_keys = self._completed_param_keys()

        total_added = 0
        source_successes = 0
        for source_study_name in source_candidates:
            source_data = _load_completed_trials_if_exists(source_study_name)
            if source_data is None:
                continue

            source_trials = self._prepare_family_source_trials(
                source_study_name=source_study_name,
                source_data=source_data,
            )
            if source_trials is None:
                continue

            import_result = self._import_family_source_trials(
                source_study_name=source_study_name,
                source_trials=source_trials,
                seen_param_keys=seen_param_keys,
                remaining_capacity=MAX_WARM_START_IMPORTED_TRIALS - total_added,
            )
            total_added += import_result.added_trials
            source_successes += int(import_result.added_trials > 0)
            self._log_family_source_import_result(
                source_study_name=source_study_name,
                import_result=import_result,
            )

            if total_added >= MAX_WARM_START_IMPORTED_TRIALS:
                logger.info(
                    "Warm start import stopped at cap of %d completed trials.",
                    MAX_WARM_START_IMPORTED_TRIALS,
                )
                break

        self._log_family_seed_summary(
            total_added=total_added,
            source_successes=source_successes,
            candidate_count=len(source_candidates),
        )
        return total_added

    def _prepare_family_source_trials(
        self,
        *,
        source_study_name: str,
        source_data: tuple[Any, list[FrozenTrial]],
    ) -> list[FrozenTrial] | None:
        source_direction, source_trials = source_data
        if source_direction != self.study.direction:
            logger.warning(
                "Warm start source '%s' skipped: direction=%s differs from target direction=%s",
                source_study_name,
                source_direction,
                self.study.direction,
            )
            return None

        if len(source_trials) <= MAX_WARM_START_TRIALS_PER_SOURCE:
            return source_trials

        logger.info(
            "Warm start source '%s' completed trials capped at %d (from %d).",
            source_study_name,
            MAX_WARM_START_TRIALS_PER_SOURCE,
            len(source_trials),
        )
        return source_trials[-MAX_WARM_START_TRIALS_PER_SOURCE:]

    def _import_family_source_trials(
        self,
        *,
        source_study_name: str,
        source_trials: list[FrozenTrial],
        seen_param_keys: set[ParamKey],
        remaining_capacity: int,
    ) -> WarmStartImportResult:
        result = WarmStartImportResult()
        for source_trial in source_trials[:remaining_capacity]:
            seeded_trial = self._convert_completed_trial_for_target(
                source_trial=source_trial,
                source_study_name=source_study_name,
            )
            if seeded_trial is None:
                result.skipped_incompatible += 1
                continue

            param_key = self._trial_param_key(seeded_trial.params)
            if param_key in seen_param_keys:
                result.skipped_duplicate += 1
                continue

            try:
                self.study.add_trial(seeded_trial)
            except Exception:
                logger.debug(
                    "Skipping warm-start add_trial for source=%s trial=%d",
                    source_study_name,
                    source_trial.number,
                    exc_info=True,
                )
                continue

            seen_param_keys.add(param_key)
            result.added_trials += 1

        return result

    def _log_family_source_import_result(
        self,
        *,
        source_study_name: str,
        import_result: WarmStartImportResult,
    ) -> None:
        if import_result.added_trials > 0:
            logger.info(
                "Warm start imported %d completed trials from '%s' (duplicates=%d, incompatible=%d).",
                import_result.added_trials,
                source_study_name,
                import_result.skipped_duplicate,
                import_result.skipped_incompatible,
            )
            return

        logger.info(
            "Warm start source '%s' had no importable completed trials (duplicates=%d, incompatible=%d).",
            source_study_name,
            import_result.skipped_duplicate,
            import_result.skipped_incompatible,
        )

    def _log_family_seed_summary(
        self,
        *,
        total_added: int,
        source_successes: int,
        candidate_count: int,
    ) -> None:
        if total_added > 0:
            logger.info(
                "Warm started study '%s' with %d completed trials from %d source studies.",
                self.study_name,
                total_added,
                source_successes,
            )
            return

        logger.info(
            "Warm start for study '%s' found 0 compatible unique completed trials across %d candidates.",
            self.study_name,
            candidate_count,
        )

    def _seed_from_external_trials(
        self,
        warm_start_trials: list[WarmStartTrialSeed],
    ) -> int:
        # Prefer extension-provided seed set when available so the set users manage
        # in the UI matches the seed data actually used by backend warm-start.
        if not warm_start_trials:
            logger.info(
                "Warm start requested with 0 external seed trials; starting cold."
            )
            return 0

        effective_seeds = warm_start_trials
        if len(warm_start_trials) > MAX_EXTERNAL_WARM_START_SEEDS:
            logger.info(
                "External warm-start seeds capped at %d (from %d).",
                MAX_EXTERNAL_WARM_START_SEEDS,
                len(warm_start_trials),
            )
            effective_seeds = warm_start_trials[-MAX_EXTERNAL_WARM_START_SEEDS:]

        seen_param_keys = self._completed_param_keys()

        added_trials = 0
        skipped_incompatible = 0
        skipped_duplicate = 0
        for seed in effective_seeds:
            if added_trials >= MAX_WARM_START_IMPORTED_TRIALS:
                break

            seeded_trial = self._convert_external_seed_for_target(seed)
            if seeded_trial is None:
                skipped_incompatible += 1
                continue

            param_key = self._trial_param_key(seeded_trial.params)
            if param_key in seen_param_keys:
                skipped_duplicate += 1
                continue

            try:
                self.study.add_trial(seeded_trial)
                seen_param_keys.add(param_key)
                added_trials += 1
            except Exception:
                logger.debug(
                    "Skipping external warm-start add_trial params=%s",
                    seeded_trial.params,
                    exc_info=True,
                )

        if added_trials >= MAX_WARM_START_IMPORTED_TRIALS:
            logger.info(
                "External warm-start import stopped at cap of %d completed trials.",
                MAX_WARM_START_IMPORTED_TRIALS,
            )

        logger.info(
            "Warm start imported %d/%d external seed trials (duplicates=%d, incompatible=%d).",
            added_trials,
            len(effective_seeds),
            skipped_duplicate,
            skipped_incompatible,
        )
        return added_trials

    def _convert_completed_trial_for_target(
        self,
        source_trial: FrozenTrial,
        source_study_name: str,
    ) -> FrozenTrial | None:
        if source_trial.value is None:
            return None

        target_params: dict[str, Any] = {}
        for param_name, distribution in self._base_distributions.items():
            if param_name not in source_trial.params:
                return None
            value = source_trial.params[param_name]
            if not self._distribution_contains_external_value(distribution, value):
                return None
            target_params[param_name] = value

        user_attrs = dict(source_trial.user_attrs)
        user_attrs.setdefault("warm_start_source_study", source_study_name)
        user_attrs.setdefault("warm_start_source_trial", source_trial.number)

        return optuna.trial.create_trial(
            params=target_params,
            distributions=self._base_distributions,
            value=source_trial.value,
            state=TrialState.COMPLETE,
            user_attrs=user_attrs,
        )

    def _convert_external_seed_for_target(
        self,
        seed: WarmStartTrialSeed,
    ) -> FrozenTrial | None:
        try:
            value = float(seed.value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(value):
            return None

        target_params: dict[str, Any] = {}
        for param_name, distribution in self._base_distributions.items():
            if param_name not in seed.params:
                return None
            param_value = seed.params[param_name]
            if not self._distribution_contains_external_value(distribution, param_value):
                return None
            target_params[param_name] = param_value

        return optuna.trial.create_trial(
            params=target_params,
            distributions=self._base_distributions,
            value=value,
            state=TrialState.COMPLETE,
            user_attrs={"warm_start_source": "extension_history"},
        )

    def _trial_param_key(self, params: dict[str, Any]) -> ParamKey:
        key_parts: list[tuple[str, str]] = []
        for param_name, distribution in self._base_distributions.items():
            if param_name not in params:
                continue
            try:
                internal_value = distribution.to_internal_repr(params[param_name])
            except Exception:
                internal_value = params[param_name]
            key_parts.append((param_name, repr(internal_value)))
        key_parts.sort(key=lambda item: item[0])
        return tuple(key_parts)

    def _completed_param_keys(self) -> set[ParamKey]:
        return {
            self._trial_param_key(existing_trial.params)
            for existing_trial in self.study.get_trials(
                deepcopy=False,
                states=(TrialState.COMPLETE,),
            )
        }

    def _current_best_snapshot(
        self,
    ) -> tuple[float | None, dict[str, Any] | None]:
        try:
            best_trial = self.study.best_trial
        except ValueError:
            return None, None
        return best_trial.value, dict(best_trial.params)

    def _infer_sampler_label_for_trial_number(self, trial_number: int) -> str:
        """Best-effort sampler label for a trial.

        AutoSampler internals are not guaranteed to expose a stable per-trial API,
        so we inspect sampler-related attrs when available and otherwise fall back
        to the study sampler class name.
        """
        trial_attrs: list[dict[str, Any]] = []
        trial = self._pending_trials.get(trial_number)
        if trial is not None:
            trial_attrs.extend([trial.system_attrs, trial.user_attrs])

        try:
            frozen = self.study.get_trials(deepcopy=False)[trial_number]
            trial_attrs.extend([frozen.system_attrs, frozen.user_attrs])
        except Exception:
            pass

        for attrs in trial_attrs:
            sampler_label = self._extract_sampler_label_from_attrs(attrs)
            if sampler_label:
                return sampler_label

        return self.study.sampler.__class__.__name__

    @staticmethod
    def _extract_sampler_label_from_attrs(attrs: Mapping[str, object]) -> str | None:
        for key, value in attrs.items():
            if "sampler" not in key.lower():
                continue
            sampler_label = OptunaOptimizer._extract_sampler_label_value(value)
            if sampler_label:
                return sampler_label
        return None

    @staticmethod
    def _extract_sampler_label_value(value: object) -> str | None:
        if isinstance(value, str) and value:
            return value
        if not isinstance(value, dict):
            return None
        return OptunaOptimizer._extract_sampler_label_from_mapping(
            cast(Mapping[str, object], value),
        )

    @staticmethod
    def _extract_sampler_label_from_mapping(
        attrs: Mapping[str, object],
    ) -> str | None:
        for candidate in ("sampler_name", "sampler", "name", "class_name", "type"):
            candidate_value = attrs.get(candidate)
            if isinstance(candidate_value, str) and candidate_value:
                return candidate_value
        return None

    @staticmethod
    def _distribution_contains_external_value(
        distribution: optuna.distributions.BaseDistribution,
        value: Any,
    ) -> bool:
        if isinstance(distribution, optuna.distributions.FloatDistribution):
            return OptunaOptimizer._float_distribution_contains_external_value(
                distribution,
                value,
            )

        if isinstance(distribution, optuna.distributions.IntDistribution):
            return OptunaOptimizer._int_distribution_contains_external_value(
                distribution,
                value,
            )

        if isinstance(distribution, optuna.distributions.CategoricalDistribution):
            return value in distribution.choices

        # Fallback: any value that can be represented by the distribution is accepted.
        return OptunaOptimizer._distribution_can_represent_value(
            distribution,
            value,
        )

    @staticmethod
    def _float_distribution_contains_external_value(
        distribution: optuna.distributions.FloatDistribution,
        value: Any,
    ) -> bool:
        try:
            cast_value = float(value)
        except (TypeError, ValueError):
            return False
        if not math.isfinite(cast_value):
            return False
        if cast_value < distribution.low or cast_value > distribution.high:
            return False
        if distribution.step is None:
            return True
        return OptunaOptimizer._is_float_step_aligned(
            low=distribution.low,
            step=distribution.step,
            cast_value=cast_value,
        )

    @staticmethod
    def _is_float_step_aligned(
        *,
        low: float,
        step: float,
        cast_value: float,
    ) -> bool:
        k = (cast_value - low) / step
        return abs(k - round(k)) < 1.0e-8

    @staticmethod
    def _int_distribution_contains_external_value(
        distribution: optuna.distributions.IntDistribution,
        value: Any,
    ) -> bool:
        if isinstance(value, bool):
            return False
        try:
            cast_value = int(value)
        except (TypeError, ValueError):
            return False
        if cast_value < distribution.low or cast_value > distribution.high:
            return False
        step = distribution.step or 1
        return (cast_value - distribution.low) % step == 0

    @staticmethod
    def _distribution_can_represent_value(
        distribution: optuna.distributions.BaseDistribution,
        value: Any,
    ) -> bool:
        try:
            distribution.to_internal_repr(value)
        except Exception:
            return False
        return True

    @staticmethod
    def _build_distributions(
        search_space: list[SearchSpaceParamInput],
    ) -> dict[str, optuna.distributions.BaseDistribution]:
        distributions: dict[str, optuna.distributions.BaseDistribution] = {}

        for param in search_space:
            if param.type == "float":
                distributions[param.name] = optuna.distributions.FloatDistribution(
                    low=param.low,
                    high=param.high,
                    step=param.step,
                    log=param.log,
                )
            elif param.type == "int":
                distributions[param.name] = optuna.distributions.IntDistribution(
                    low=param.low,
                    high=param.high,
                    step=param.step or 1,
                    log=param.log,
                )
            else:
                distributions[param.name] = (
                    optuna.distributions.CategoricalDistribution(
                        choices=tuple(param.choices),
                    )
                )

        return distributions

    @staticmethod
    def delete_study(study_name: str) -> None:
        storage = _create_storage(_storage_url_for_study(study_name))
        deleted_via_optuna = False
        # M10: Use Optuna's API to cleanly remove the study from storage
        try:
            optuna.delete_study(study_name=study_name, storage=storage)
            deleted_via_optuna = True
            logger.info("Deleted study '%s' via Optuna API", study_name)
        except KeyError:
            logger.info("Study '%s' not found in Optuna storage; will still cleanup files", study_name)
        except OSError as exc:
            logger.warning(
                "Delete study '%s' hit OS error (%s). Proceeding with file cleanup.",
                study_name,
                exc,
            )
        finally:
            _dispose_storage_handles(storage)

        files_removed = _remove_study_files(study_name)
        if deleted_via_optuna and not files_removed:
            logger.warning(
                "Study '%s' deleted in Optuna storage but SQLite files are still present.",
                study_name,
            )

    @staticmethod
    def delete_study_family(study_family: str) -> None:
        candidates: set[str] = set()
        family_path = _storage_path_for_study(study_family)
        if family_path.exists():
            candidates.add(study_family)
        for path in STORAGE_DIR.glob(f"{study_family}_warm_*.db"):
            candidates.add(path.stem)

        if not candidates:
            logger.info("Study family '%s' not found for deletion", study_family)
            return

        deleted_count = 0
        for study_name in sorted(candidates):
            try:
                OptunaOptimizer.delete_study(study_name)
                deleted_count += 1
            except Exception:
                logger.exception("Failed deleting study '%s' from family '%s'", study_name, study_family)
        logger.info(
            "Deleted %d studies for family '%s'",
            deleted_count,
            study_family,
        )
