import os
from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    PROJECT_NAME: str = "SmartHome Central Management Platform"
    VERSION: str = "1.6.0"
    API_V1_PREFIX: str = "/api/v1"
    
    # Server Listening
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    
    # Raw TCP Socket Communication
    TCP_SERVER_ENABLED: bool = True
    TCP_SERVER_HOST: str = "0.0.0.0"
    TCP_SERVER_PORT: int = 2000
    TCP_BUFFER_SIZE: int = 4096
    
    # MQTT Communication
    MQTT_ENABLED: bool = True
    MQTT_BROKER_HOST: str = "localhost"
    MQTT_BROKER_PORT: int = 1883
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""
    MQTT_CLIENT_ID: str = "smarthome_central_platform"
    MQTT_KEEPALIVE: int = 60
    
    # Database Configuration (PostgreSQL primary with automatic SQLite fallback)
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/smarthome_db",
        description="Async connection string for PostgreSQL"
    )
    DATABASE_FALLBACK_URL: str = "sqlite+aiosqlite:///./data/smarthome.db"
    USE_SQLITE_FALLBACK: bool = True
    
    # Security & Authentication
    JWT_SECRET_KEY: str = "smarthome-jwt-super-secure-key-production-change-2026"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ADMIN_DEFAULT_USERNAME: str = "admin"
    ADMIN_DEFAULT_PASSWORD: str = "admin123"
    
    # Device Fleet Management
    NODE_OFFLINE_THRESHOLD_SEC: int = 35
    COMMAND_TIMEOUT_SEC: float = 2.5
    
    # Storage Paths
    FIRMWARE_STORAGE_PATH: str = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "firmware_storage"))
    BACKUP_DIR: str = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backups"))
    DATA_DIR: str = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
    
    # CORS
    CORS_ORIGINS: List[str] = ["*"]

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()

# Ensure necessary directories exist
os.makedirs(settings.FIRMWARE_STORAGE_PATH, exist_ok=True)
os.makedirs(settings.BACKUP_DIR, exist_ok=True)
os.makedirs(settings.DATA_DIR, exist_ok=True)
