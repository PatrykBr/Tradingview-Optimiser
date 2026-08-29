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
                symbol="OANDA:XAUUSD", timeframe="5", strategy_name="Test Strategy"
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
