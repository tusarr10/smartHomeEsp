from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.nodes import router as nodes_router
from app.api.v1.relays import router as relays_router
from app.api.v1.sensors import router as sensors_router
from app.api.v1.automations import router as automations_router
from app.api.v1.firmware import router as firmware_router
from app.api.v1.system import router as system_router
from app.api.v1.websocket import router as ws_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(nodes_router)
api_router.include_router(relays_router)
api_router.include_router(sensors_router)
api_router.include_router(automations_router)
api_router.include_router(firmware_router)
api_router.include_router(system_router)
api_router.include_router(ws_router)
