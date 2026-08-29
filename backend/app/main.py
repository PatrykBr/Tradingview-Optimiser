from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.api.websocket import websocket_endpoint
from app.optimisation.manager import OptimisationManager
from app.pairing import PairingManager
from app.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    app.state.settings = settings
    app.state.pairing_manager = PairingManager(
        settings.extension_token_path,
        configured_token=settings.extension_token,
    )
    app.state.optimisation_manager = OptimisationManager(settings.database_url)
    yield


app = FastAPI(
    title="TradingView Optuna Optimiser",
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)
app.include_router(router)
app.add_api_websocket_route("/ws", websocket_endpoint)
