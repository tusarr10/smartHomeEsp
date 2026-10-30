import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from passlib.context import CryptContext
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.config import settings
from app.database import get_db
from app.models.user import User, Role

logger = logging.getLogger("AuthService")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

async def seed_initial_admin(db: AsyncSession):
    """Creates default roles and admin account if none exist."""
    try:
        # Check or create Administrator Role
        stmt = select(Role).where(Role.name == "Administrator")
        res = await db.execute(stmt)
        admin_role = res.scalars().first()
        if not admin_role:
            admin_role = Role(name="Administrator", description="Full system access")
            db.add(admin_role)
            await db.flush()

        # Check or create Admin User
        stmt = select(User).where(User.username == settings.ADMIN_DEFAULT_USERNAME)
        res = await db.execute(stmt)
        admin_user = res.scalars().first()
        if not admin_user:
            admin_user = User(
                username=settings.ADMIN_DEFAULT_USERNAME,
                email="admin@smarthome.local",
                password_hash=get_password_hash(settings.ADMIN_DEFAULT_PASSWORD),
                is_active=True,
                is_superuser=True,
                role_id=admin_role.id
            )
            db.add(admin_user)
            await db.commit()
            logger.info(f"Default admin user created: {settings.ADMIN_DEFAULT_USERNAME}")
    except Exception as e:
        logger.error(f"Error seeding initial admin: {e}")
        await db.rollback()

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    stmt = select(User).where(User.username == username)
    res = await db.execute(stmt)
    user = res.scalars().first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user
