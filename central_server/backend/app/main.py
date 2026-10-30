import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import settings
from app.database import setup_database, async_engine, Base
from app.services.auth_service import seed_initial_admin
from app.services.device_service import device_service
from app.services.automation_engine import automation_engine
from app.protocols.tcp_server import tcp_server
from app.protocols.mqtt_client import mqtt_manager
from app.api.api_router import api_router

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("Main")

offline_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global offline_task
    logger.info("=" * 65)
    logger.info(f" [*] {settings.PROJECT_NAME} v{settings.VERSION}")
    logger.info("=" * 65)

    # 1. Initialize Database Engine & Schema
    await setup_database()
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database schema initialized and verified.")

    # 2. Seed Default Administrator Account
    from app.database import async_session_factory
    async with async_session_factory() as session:
        await seed_initial_admin(session)

    # 3. Start Multi-Protocol Services
    if settings.TCP_SERVER_ENABLED:
        await tcp_server.start()

    if settings.MQTT_ENABLED:
        await mqtt_manager.start()

    # 4. Start Background Automation Engine & Offline Watcher
    await automation_engine.start()
    offline_task = asyncio.create_task(device_service.check_offline_loop())

    logger.info(f" >> Web Dashboard: http://localhost:{settings.PORT}")
    logger.info(f" >> TCP Listener:  {settings.TCP_SERVER_HOST}:{settings.TCP_SERVER_PORT}")
    logger.info(f" >> MQTT Target:   {settings.MQTT_BROKER_HOST}:{settings.MQTT_BROKER_PORT}")
    logger.info("=" * 65)

    yield

    # Shutdown Phase
    logger.info("Shutting down background services...")
    if offline_task:
        offline_task.cancel()
    await automation_engine.stop()
    await tcp_server.stop()
    await mqtt_manager.stop()
    logger.info("All services stopped gracefully.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    redoc_url=f"{settings.API_V1_PREFIX}/redoc"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include Main API Router
app.include_router(api_router, prefix=settings.API_V1_PREFIX)

# Serve Frontend SPA Dashboard
FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))

if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Allow API routes to be handled by FastAPI
        if full_path.startswith("api"):
            return None
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
