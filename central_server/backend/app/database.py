import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker, AsyncAttrs
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

logger = logging.getLogger("Database")

class Base(AsyncAttrs, DeclarativeBase):
    pass

# Engine & Sessionmaker placeholders
async_engine = None
async_session_factory = None

async def setup_database():
    global async_engine, async_session_factory
    
    primary_url = settings.DATABASE_URL
    fallback_url = settings.DATABASE_FALLBACK_URL
    
    # Try primary database (PostgreSQL)
    try:
        logger.info(f"Connecting to primary database: {primary_url.split('@')[-1] if '@' in primary_url else primary_url}")
        test_engine = create_async_engine(primary_url, echo=settings.DEBUG, pool_pre_ping=True)
        async with test_engine.connect() as conn:
            # Test query
            from sqlalchemy import text
            await conn.execute(text("SELECT 1"))
        
        async_engine = test_engine
        async_session_factory = async_sessionmaker(async_engine, expire_on_commit=False, class_=AsyncSession)
        logger.info("Successfully connected to primary PostgreSQL database.")
        return
    except Exception as e:
        logger.warning(f"Could not connect to primary database ({e}).")
        if not settings.USE_SQLITE_FALLBACK:
            raise e

    # Fallback to local SQLite async database
    logger.warning(f"Falling back to local SQLite database: {fallback_url}")
    async_engine = create_async_engine(
        fallback_url,
        echo=settings.DEBUG,
        connect_args={"check_same_thread": False}
    )
    async_session_factory = async_sessionmaker(async_engine, expire_on_commit=False, class_=AsyncSession)
    logger.info("Successfully initialized SQLite fallback database engine.")

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    if async_session_factory is None:
        await setup_database()
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
