from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.models import RunProgress
from app.optimisation.manager import OptimisationManager
from app.pairing import PairingError, PairingManager

router = APIRouter()


class PairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=4, max_length=64)


class PairResponse(BaseModel):
    token: str


def get_manager(request: Request) -> OptimisationManager:
    return request.app.state.optimisation_manager


def get_pairing_manager(request: Request) -> PairingManager:
    return request.app.state.pairing_manager


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/pair", responses={403: {"description": "Pairing code rejected"}})
async def pair_backend(
    body: PairRequest,
    pairing: Annotated[PairingManager, Depends(get_pairing_manager)],
) -> PairResponse:
    try:
        token = pairing.pair(body.code)
    except PairingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return PairResponse(token=token)


@router.get(
    "/runs/{run_id}",
    responses={
        401: {"description": "A paired backend token is required"},
        404: {"description": "Run not found"},
    },
)
async def get_run(
    run_id: str,
    request: Request,
    manager: Annotated[OptimisationManager, Depends(get_manager)],
    pairing: Annotated[PairingManager, Depends(get_pairing_manager)],
) -> RunProgress:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not pairing.verify_token(token):
        raise HTTPException(
            status_code=401,
            detail="a paired backend token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return await manager.progress(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
