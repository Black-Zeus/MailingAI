from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.repositories import users_repository
from app.schemas.users import UserDirectoryEntry

router = APIRouter(prefix="/api/users", tags=["users"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("", response_model=list[UserDirectoryEntry])
async def list_user_directory(pool: PoolDep, _user: CurrentUserDep) -> list[UserDirectoryEntry]:
    """Directorio de usuarios habilitados -- lo usa el selector de "Compartir"
    en expedientes/buzones. Accesible a cualquier usuario logueado (no solo
    admin): compartir no es una operacion administrativa."""
    records = await users_repository.list_enabled_users(pool)
    return [UserDirectoryEntry(**dict(r)) for r in records]
