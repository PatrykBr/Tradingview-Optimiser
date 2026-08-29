from pathlib import Path

import pytest

from app.models import ChartContext, CreateRun, MetricFilter, ObjectiveDirection, TrialResult
from app.optimisation.manager import OptimisationManager


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
    assert len(progress.trials) == 2
    assert progress.trials[0].state == "complete"
    assert progress.trials[0].objective_value == pytest.approx(2.2)
    assert progress.trials[1].objective_value == pytest.approx(1.7)


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
    with pytest.raises(ValueError, match="different configuration"):
        await restarted_manager.create_run(make_config("config-test", target_trials=3))


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
