from pathlib import Path
from unittest.mock import patch

import optuna
import pytest

from app.models import (
    ChartContext,
    CreateRun,
    MetricFilter,
    ObjectiveDirection,
    TrialFailure,
    TrialResult,
)
from app.optimisation.manager import OptimisationManager


@pytest.mark.asyncio
async def test_studies_reuse_storage_and_close_connections(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'shared.db'}")
    with patch(
        "app.optimisation.manager.optuna.create_study", wraps=optuna.create_study
    ) as create:
        await manager.create_run(make_config("first-storage-run"))
        await manager.create_run(make_config("second-storage-run"))
    first_storage = create.call_args_list[0].kwargs["storage"]
    assert first_storage is create.call_args_list[1].kwargs["storage"]
    with (
        patch.object(first_storage, "remove_session") as remove_session,
        patch.object(first_storage.engine, "dispose") as dispose,
    ):
        manager.close()
        remove_session.assert_called_once()
        dispose.assert_called_once()
    manager.close()


def make_config(run_id: str, target_trials: int = 2) -> CreateRun:
    return CreateRun.model_validate(
        {
            "run_id": run_id,
            "objective_metric": "profitFactor",
            "direction": ObjectiveDirection.MAXIMIZE,
            "target_trials": target_trials,
            "parameters": [
                {"type": "int", "name": "length", "low": 5, "high": 20, "step": 1},
                {"type": "float", "name": "risk", "low": 0.5, "high": 2.0, "step": 0.1},
                {"type": "categorical", "name": "filter", "choices": [True, False]},
            ],
            "filters": [
                MetricFilter(metric="maxDrawdownPercent", operator="lte", value=8).model_dump(),
                MetricFilter(metric="profitFactor", operator="gte", value=1.3).model_dump(),
                MetricFilter(metric="totalTrades", operator="gte", value=100).model_dump(),
            ],
            "chart": ChartContext(
                symbol="OANDA:XAUUSD", timeframe="5", strategy_name="Test Strategy",
                strategy_signature="signature-123",
            ).model_dump(),
        }
    )


@pytest.mark.parametrize("baseline", [4, 21, 8, 8.5, True, "10"])
def test_invalid_baseline_is_rejected(baseline) -> None:
    config = make_config("invalid-baseline").model_dump()
    config["parameters"][0]["step"] = 6
    config["baseline_parameters"] = {"length": baseline}
    with pytest.raises(ValueError, match="outside the search space"):
        CreateRun.model_validate(config)


@pytest.mark.asyncio
async def test_constraints_choose_best_feasible(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    await manager.create_run(make_config("constraint-test"))
    _, first = await manager.start("constraint-test")
    assert first is not None

    progress, second = await manager.submit_result(
        TrialResult(
            run_id="constraint-test",
            trial_number=first.trial_number,
            metrics={
                "profitFactor": 2.2,
                "maxDrawdownPercent": 15,
                "totalTrades": 200,
            },
        )
    )
    assert progress.best is None
    assert second is not None

    progress, third = await manager.submit_result(
        TrialResult(
            run_id="constraint-test",
            trial_number=second.trial_number,
            metrics={
                "profitFactor": 1.7,
                "maxDrawdownPercent": 6,
                "totalTrades": 180,
            },
        )
    )
    assert third is None
    assert progress.best is not None
    assert progress.best.objective_value == pytest.approx(1.7)
    assert all(value <= 0 for value in progress.best.constraints.values())
    full_progress = await manager.progress("constraint-test")
    assert len(full_progress.trials) == 2
    assert full_progress.trials[0].state == "complete"
    assert full_progress.trials[0].objective_value == pytest.approx(2.2)
    assert full_progress.trials[1].objective_value == pytest.approx(1.7)
    assert [trial.trial_number for trial in progress.trial_updates] == [
        second.trial_number
    ]


@pytest.mark.asyncio
async def test_stop_finishes_after_outstanding_trial(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    await manager.create_run(make_config("stop-test", target_trials=10))
    _, trial = await manager.start("stop-test")
    assert trial is not None

    progress = await manager.stop("stop-test")
    assert progress.status == "stop_requested"

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id="stop-test",
            trial_number=trial.trial_number,
            metrics={
                "profitFactor": 1.5,
                "maxDrawdownPercent": 5,
                "totalTrades": 150,
            },
        )
    )
    assert progress.status == "stopped"
    assert next_trial is None


@pytest.mark.asyncio
async def test_no_trade_trial_is_completed_with_poor_objective(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("no-trade-test", target_trials=1)
    config.filters = []
    await manager.create_run(config)

    _, active = await manager.start("no-trade-test")
    assert active is not None

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id="no-trade-test",
            trial_number=active.trial_number,
            metrics={"totalTrades": 0},
        )
    )

    assert next_trial is None
    assert progress.status == "completed"
    assert progress.best is not None
    assert progress.best.objective_value == pytest.approx(-1.0e12)


@pytest.mark.asyncio
async def test_missing_constraint_metric_with_trades_is_an_error(
    tmp_path: Path,
) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("missing-filter-metric", target_trials=1)
    await manager.create_run(config)

    _, active = await manager.start(config.run_id)
    assert active is not None

    result = TrialResult(
        run_id=config.run_id,
        trial_number=active.trial_number,
        metrics={"profitFactor": 1.7, "totalTrades": 150},
    )
    with pytest.raises(ValueError, match="constraint metric 'maxDrawdownPercent' missing"):
        await manager.submit_result(result)


@pytest.mark.asyncio
async def test_no_trade_missing_constraint_metrics_are_infeasible_not_errors(
    tmp_path: Path,
) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("no-trade-filter-test", target_trials=1)
    await manager.create_run(config)

    _, active = await manager.start(config.run_id)
    assert active is not None

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id=config.run_id,
            trial_number=active.trial_number,
            metrics={"totalTrades": 0},
        )
    )

    assert next_trial is None
    assert progress.status == "completed"
    assert progress.best is None
    assert progress.completed_trials == 1


@pytest.mark.asyncio
async def test_abort_fails_outstanding_browser_trial_and_stops_run(
    tmp_path: Path,
) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("abort-run-test", target_trials=10)
    await manager.create_run(config)

    _, active = await manager.start(config.run_id)
    assert active is not None

    progress = await manager.abort(
        config.run_id,
        "owner tab disappeared",
    )

    assert progress.status == "stopped"
    assert progress.termination_reason == "user"
    assert progress.failed_trials == 1
    assert progress.trials[-1].failure_reason == "owner tab disappeared"

    restarted = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    restored = await restarted.create_run(config)
    assert restored.status == "stopped"
    assert restored.failed_trials == 1


def test_conditional_controller_can_appear_after_child() -> None:
    config = CreateRun.model_validate(
        {
            "run_id": "later-controller",
            "objective_metric": "profitFactor",
            "direction": "maximize",
            "target_trials": 1,
            "parameters": [
                {
                    "type": "int",
                    "name": "atr_period",
                    "low": 5,
                    "high": 50,
                    "condition": {
                        "parameter": "stop_type",
                        "values": ["ATR Bars"],
                    },
                },
                {
                    "type": "categorical",
                    "name": "stop_type",
                    "choices": ["ATR Bars", "Percent", "Swing H/L"],
                },
            ],
            "filters": [],
            "chart": {
                "symbol": "OANDA:XAUUSD",
                "timeframe": "5",
                "strategy_name": "Test Strategy",
                "strategy_signature": "signature-123",
            },
        }
    )

    assert [parameter.name for parameter in config.parameters] == [
        "stop_type",
        "atr_period",
    ]


def test_conditional_dependency_cycles_are_rejected() -> None:
    with pytest.raises(ValueError, match="contain a cycle"):
        CreateRun.model_validate(
            {
                "run_id": "condition-cycle",
                "objective_metric": "profitFactor",
                "direction": "maximize",
                "target_trials": 1,
                "parameters": [
                    {
                        "type": "categorical",
                        "name": "mode_a",
                        "choices": [True, False],
                        "condition": {
                            "parameter": "mode_b",
                            "values": [True],
                        },
                    },
                    {
                        "type": "categorical",
                        "name": "mode_b",
                        "choices": [True, False],
                        "condition": {
                            "parameter": "mode_a",
                            "values": [True],
                        },
                    },
                ],
                "filters": [],
                "chart": {
                    "symbol": "OANDA:XAUUSD",
                    "timeframe": "5",
                    "strategy_name": "Test Strategy",
                    "strategy_signature": "signature-123",
                },
            }
        )


def test_conditional_parameter_matches_sampled_parent() -> None:
    config = CreateRun.model_validate(
        {
            "run_id": "conditional-test",
            "objective_metric": "profitFactor",
            "direction": "maximize",
            "target_trials": 1,
            "parameters": [
                {
                    "type": "categorical",
                    "name": "enabled",
                    "choices": [True, False],
                },
                {
                    "type": "int",
                    "name": "length",
                    "low": 5,
                    "high": 20,
                    "condition": {
                        "parameter": "enabled",
                        "values": [True],
                    },
                },
            ],
            "filters": [],
            "chart": {
                "symbol": "OANDA:XAUUSD",
                "timeframe": "5",
                "strategy_name": "Test Strategy",
                "strategy_signature": "signature-123",
            },
        }
    )

    child = config.parameters[1]
    assert OptimisationManager._condition_matches(child, {"enabled": True})
    assert not OptimisationManager._condition_matches(child, {"enabled": False})



@pytest.mark.asyncio
async def test_restart_fails_orphaned_running_trial(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    first_manager = OptimisationManager(database_url)
    config = make_config("restart-test", target_trials=3)

    await first_manager.create_run(config)
    _, orphaned_trial = await first_manager.start("restart-test")
    assert orphaned_trial is not None

    restarted_manager = OptimisationManager(database_url)
    progress = await restarted_manager.create_run(config)

    assert progress.status == "created"
    assert progress.failed_trials == 1

    progress, replacement_trial = await restarted_manager.start("restart-test")
    assert progress.status == "running"
    assert replacement_trial is not None
    assert replacement_trial.trial_number != orphaned_trial.trial_number


@pytest.mark.asyncio
async def test_restart_rejects_different_persisted_configuration(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    first_manager = OptimisationManager(database_url)
    await first_manager.create_run(make_config("config-test", target_trials=2))

    restarted_manager = OptimisationManager(database_url)
    changed_config = make_config("config-test", target_trials=3)
    with pytest.raises(ValueError, match="different configuration"):
        await restarted_manager.create_run(changed_config)


@pytest.mark.asyncio
async def test_stopped_run_remains_stopped_after_backend_restart(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    first_manager = OptimisationManager(database_url)
    config = make_config("stopped-test", target_trials=3)
    await first_manager.create_run(config)
    _, active = await first_manager.start("stopped-test")
    assert active is not None

    await first_manager.stop("stopped-test")
    progress, _ = await first_manager.submit_result(
        TrialResult(
            run_id="stopped-test",
            trial_number=active.trial_number,
            metrics={
                "profitFactor": 1.5,
                "maxDrawdownPercent": 5,
                "totalTrades": 150,
            },
        )
    )
    assert progress.status == "stopped"

    restarted_manager = OptimisationManager(database_url)
    progress = await restarted_manager.create_run(config)
    assert progress.status == "stopped"



@pytest.mark.asyncio
async def test_current_parameters_are_enqueued_as_first_trial(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("baseline-test", target_trials=1)
    config.baseline_parameters = {
        "length": 14,
        "risk": 1.0,
        "filter": True,
    }

    await manager.create_run(config)
    _, first = await manager.start("baseline-test")

    assert first is not None
    assert first.parameters == config.baseline_parameters



@pytest.mark.asyncio
async def test_convergence_stops_flat_study_early(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("convergence-test", target_trials=20)
    config.research.convergence.enabled = True
    config.research.convergence.min_trials = 5
    config.research.convergence.patience = 2
    config.research.convergence.min_improvement_percent = 1.0

    await manager.create_run(config)
    _, active = await manager.start("convergence-test")
    assert active is not None

    progress = None
    for _ in range(20):
        progress, next_trial = await manager.submit_result(
            TrialResult(
                run_id="convergence-test",
                trial_number=active.trial_number,
                metrics={
                    "profitFactor": 1.5,
                    "maxDrawdownPercent": 5,
                    "totalTrades": 150,
                },
            )
        )

        if next_trial is None:
            break

        active = next_trial

    assert progress is not None
    assert progress.status == "completed"
    assert progress.termination_reason == "converged"
    assert progress.completed_trials < config.target_trials


@pytest.mark.asyncio
async def test_run_analysis_returns_normalised_parameter_importance(
    tmp_path: Path,
) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("importance-test", target_trials=20)
    config.filters = []

    await manager.create_run(config)
    _, active = await manager.start("importance-test")
    assert active is not None

    while active is not None:
        length = float(active.parameters["length"])

        progress, active = await manager.submit_result(
            TrialResult(
                run_id="importance-test",
                trial_number=active.trial_number,
                metrics={
                    "profitFactor": length,
                    "totalTrades": 150,
                },
            )
        )

    assert progress.status == "completed"

    analysis = await manager.analysis("importance-test")

    assert analysis.completed_trials == 20
    assert analysis.parameter_importance
    assert set(analysis.parameter_importance).issubset(
        {"length", "risk", "filter"}
    )
    assert sum(analysis.parameter_importance.values()) == pytest.approx(1.0)



@pytest.mark.asyncio
async def test_completed_temporary_run_can_be_deleted(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    manager = OptimisationManager(database_url)
    config = make_config("delete-test", target_trials=1)
    config.filters = []

    await manager.create_run(config)
    _, active = await manager.start("delete-test")
    assert active is not None

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id="delete-test",
            trial_number=active.trial_number,
            metrics={
                "profitFactor": 1.5,
                "totalTrades": 100,
            },
        )
    )

    assert progress.status == "completed"
    assert next_trial is None

    await manager.delete_run("delete-test")

    with pytest.raises(KeyError, match="unknown run_id"):
        await manager.progress("delete-test")

    reloaded = OptimisationManager(database_url)
    recreated = await reloaded.create_run(config)
    assert recreated.status == "created"
    assert recreated.completed_trials == 0


@pytest.mark.asyncio
async def test_active_run_cannot_be_deleted(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("active-delete-test", target_trials=3)

    await manager.create_run(config)
    _, active = await manager.start("active-delete-test")
    assert active is not None

    with pytest.raises(ValueError, match="cannot delete an active"):
        await manager.delete_run("active-delete-test")


@pytest.mark.asyncio
async def test_exact_duplicate_trials_reuse_completed_results(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = CreateRun.model_validate(
        {
            "run_id": "duplicate-reuse-test",
            "objective_metric": "profitFactor",
            "direction": "maximize",
            "target_trials": 4,
            "parameters": [
                {
                    "type": "float",
                    "name": "risk",
                    "low": 0.5,
                    "high": 2.0,
                }
            ],
            "filters": [
                {
                    "metric": "totalTrades",
                    "operator": "gte",
                    "value": 100,
                }
            ],
            "chart": {
                "symbol": "OANDA:XAUUSD",
                "timeframe": "5",
                "strategy_name": "Test Strategy",
                "strategy_signature": "signature-123",
            },
            "baseline_parameters": {"risk": 1.0},
        }
    )

    await manager.create_run(config)
    run = manager._runs[config.run_id]
    for _ in range(3):
        run.study.enqueue_trial({"risk": 1.0})

    _, active = await manager.start(config.run_id)
    assert active is not None
    assert active.parameters == {"risk": 1.0}

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id=config.run_id,
            trial_number=active.trial_number,
            metrics={
                "profitFactor": 1.8,
                "totalTrades": 150,
            },
        )
    )

    assert next_trial is None
    assert progress.status == "completed"
    assert progress.completed_trials == config.target_trials
    assert progress.reused_trials == 3

    reused = [
        trial
        for trial in progress.trial_updates
        if trial.reused_from_trial is not None
    ]
    assert len(reused) == 3

    for trial in reused:
        source = next(
            item
            for item in progress.trial_updates
            if item.trial_number == trial.reused_from_trial
        )
        assert source.trial_number == 0
        assert trial.objective_value == source.objective_value
        assert trial.metrics == source.metrics
        assert trial.constraints == source.constraints
        assert trial.duration_ms is None


@pytest.mark.asyncio
async def test_duplicate_reuse_survives_backend_restart(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    config = CreateRun.model_validate(
        {
            "run_id": "duplicate-restart-test",
            "objective_metric": "profitFactor",
            "direction": "maximize",
            "target_trials": 2,
            "parameters": [
                {
                    "type": "float",
                    "name": "risk",
                    "low": 0.5,
                    "high": 2.0,
                }
            ],
            "filters": [],
            "chart": {
                "symbol": "OANDA:XAUUSD",
                "timeframe": "5",
                "strategy_name": "Test Strategy",
                "strategy_signature": "signature-123",
            },
            "baseline_parameters": {"risk": 1.0},
        }
    )

    first_manager = OptimisationManager(database_url)
    await first_manager.create_run(config)
    _, first = await first_manager.start(config.run_id)
    assert first is not None
    assert first.parameters == {"risk": 1.0}

    progress, orphaned = await first_manager.submit_result(
        TrialResult(
            run_id=config.run_id,
            trial_number=first.trial_number,
            metrics={
                "profitFactor": 1.8,
                "totalTrades": 150,
            },
        )
    )
    assert progress.completed_trials == 1
    assert orphaned is not None

    restarted = OptimisationManager(database_url)
    progress = await restarted.create_run(config)
    assert progress.completed_trials == 1
    assert progress.failed_trials == 1

    restarted._runs[config.run_id].study.enqueue_trial({"risk": 1.0})
    progress, active = await restarted.start(config.run_id)

    assert active is None
    assert progress.status == "completed"
    assert progress.completed_trials == config.target_trials
    assert progress.reused_trials == 1


def test_finite_search_space_cardinality_accounts_for_conditions() -> None:
    config = CreateRun.model_validate(
        {
            "run_id": "cardinality-test",
            "objective_metric": "profitFactor",
            "direction": "maximize",
            "target_trials": 100,
            "parameters": [
                {
                    "type": "categorical",
                    "name": "mode",
                    "choices": ["A", "B"],
                },
                {
                    "type": "int",
                    "name": "length",
                    "low": 1,
                    "high": 3,
                    "step": 1,
                    "condition": {
                        "parameter": "mode",
                        "values": ["A"],
                    },
                },
            ],
            "filters": [],
            "chart": {
                "symbol": "OANDA:XAUUSD",
                "timeframe": "5",
                "strategy_name": "Test Strategy",
                "strategy_signature": "signature-123",
            },
        }
    )

    assert OptimisationManager._finite_search_space_cardinality(
        config.parameters,
        config.target_trials,
    ) == 4


@pytest.mark.asyncio
async def test_finite_search_space_stops_when_exhausted(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    manager = OptimisationManager(database_url)
    config = CreateRun.model_validate(
        {
            "run_id": "space-exhausted-test",
            "objective_metric": "profitFactor",
            "direction": "maximize",
            "target_trials": 100,
            "parameters": [
                {
                    "type": "categorical",
                    "name": "enabled",
                    "choices": [True, False],
                }
            ],
            "filters": [],
            "chart": {
                "symbol": "OANDA:XAUUSD",
                "timeframe": "5",
                "strategy_name": "Test Strategy",
                "strategy_signature": "signature-123",
            },
            "baseline_parameters": {"enabled": True},
        }
    )

    await manager.create_run(config)

    run = manager._runs[config.run_id]
    run.study.enqueue_trial({"enabled": False})

    _, first = await manager.start(config.run_id)
    assert first is not None
    assert first.parameters == {"enabled": True}

    progress, second = await manager.submit_result(
        TrialResult(
            run_id=config.run_id,
            trial_number=first.trial_number,
            metrics={
                "profitFactor": 1.8,
                "totalTrades": 150,
            },
        )
    )
    assert second is not None
    assert second.parameters == {"enabled": False}

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id=config.run_id,
            trial_number=second.trial_number,
            metrics={
                "profitFactor": 1.4,
                "totalTrades": 150,
            },
        )
    )

    assert next_trial is None
    assert progress.status == "completed"
    assert progress.termination_reason == "search_space_exhausted"
    assert progress.completed_trials == 2
    assert progress.reused_trials == 0

    restarted = OptimisationManager(database_url)
    restored = await restarted.create_run(config)
    assert restored.status == "completed"
    assert restored.termination_reason == "search_space_exhausted"

@pytest.mark.asyncio
async def test_deleted_run_releases_per_run_lock(tmp_path: Path) -> None:
    manager = OptimisationManager(f"sqlite:///{tmp_path / 'test.db'}")
    config = make_config("lock-cleanup-test", target_trials=1)
    config.filters = []

    await manager.create_run(config)
    _, active = await manager.start(config.run_id)
    assert active is not None

    progress, next_trial = await manager.submit_result(
        TrialResult(
            run_id=config.run_id,
            trial_number=active.trial_number,
            metrics={
                "profitFactor": 1.5,
                "totalTrades": 100,
            },
        )
    )

    assert progress.status == "completed"
    assert next_trial is None
    previous_lock = manager._runs[config.run_id].lock

    await manager.delete_run(config.run_id)

    with pytest.raises(KeyError, match="unknown run_id"):
        await manager.progress(config.run_id)
    await manager.create_run(config)
    assert manager._runs[config.run_id].lock is not previous_lock
    _, replacement = await manager.start(config.run_id)
    assert replacement is not None
    assert replacement.trial_number == 0
    await manager.abort(config.run_id, "test complete")
    manager.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("direction", [ObjectiveDirection.MAXIMIZE, ObjectiveDirection.MINIMIZE])
async def test_live_and_restored_trial_caches_match(
    tmp_path: Path, direction: ObjectiveDirection,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'cache.db'}"
    config = make_config("cache-parity-test", target_trials=8)
    config.direction = direction
    manager = OptimisationManager(database_url)
    await manager.create_run(config)
    study = manager._runs[config.run_id].study
    # Include successful, filtered, failed and reused trials in one persisted history.
    for length in [5, 6, 7, 8, 5]:
        study.enqueue_trial({"length": length, "risk": 1.0, "filter": True})
    _, active = await manager.start(config.run_id)
    for metrics in [
        {"profitFactor": 2.0, "maxDrawdownPercent": 4.0, "totalTrades": 150.0},
        {"profitFactor": 3.0, "maxDrawdownPercent": 12.0, "totalTrades": 150.0},
        None,
        {"profitFactor": 1.5, "maxDrawdownPercent": 3.0, "totalTrades": 120.0},
    ]:
        assert active is not None
        if metrics is None:
            _, active = await manager.submit_failure(TrialFailure(
                run_id=config.run_id, trial_number=active.trial_number, reason="strategy failed",
            ))
        else:
            _, active = await manager.submit_result(TrialResult(
                run_id=config.run_id, trial_number=active.trial_number,
                metrics=metrics, duration_ms=50,
            ))
    expected = await manager.abort(config.run_id, "user stopped")
    assert expected.completed_trials == 4
    assert expected.failed_trials == 2
    assert expected.reused_trials == 1
    assert expected.best is not None
    expected_best = 2.0 if direction == ObjectiveDirection.MAXIMIZE else 1.5
    assert expected.best.objective_value == expected_best
    convergence = manager._runs[config.run_id].convergence_best_values.copy()
    manager.close()

    restored = OptimisationManager(database_url)
    try:
        assert await restored.create_run(config) == expected
        assert restored._runs[config.run_id].convergence_best_values == convergence
    finally:
        restored.close()

