from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.models import RunProgress
from app.optimisation.manager import OptimisationManager

router = APIRouter()


def get_manager(request: Request) -> OptimisationManager:
    return request.app.state.optimisation_manager


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/runs/{run_id}", response_model=RunProgress)
async def get_run(
    run_id: str,
    manager: Annotated[OptimisationManager, Depends(get_manager)],
) -> RunProgress:
    try:
        return await manager.progress(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
