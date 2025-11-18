from __future__ import annotations

import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    MessageType,
    OptimisationConfig,
    StartMessage,
    StopMessage,
    TrialResultMessage,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="TV Optimiser Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def read_health():
    return {"status": "ok"}


@app.websocket("/optimise")
async def optimise_ws(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")
    
    try:
        # Wait for start message
        data = await websocket.receive_json()
        if data.get("type") != MessageType.START:
            await websocket.send_json({
                MessageType.TYPE: MessageType.ERROR,
                "message": "Expected 'start' message"
            })
            await websocket.close()
            return
        
        start_message = StartMessage.model_validate(data)
        config: OptimisationConfig = start_message.config
        
        await websocket.send_json({
            MessageType.TYPE: MessageType.STATUS,
            "message": "Configuration received"
        })
        
        # Basic optimisation loop placeholder
        await websocket.send_json({
            MessageType.TYPE: MessageType.STATUS,
            "message": "Optimisation started"
        })
        
        # Wait for stop or disconnect
        while True:
            try:
                message = await websocket.receive_json()
                if message.get("type") == MessageType.STOP:
                    break
            except WebSocketDisconnect:
                break
        
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Error in WebSocket handler: {e}")
        try:
            await websocket.send_json({
                MessageType.TYPE: MessageType.ERROR,
                "message": str(e)
            })
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass

