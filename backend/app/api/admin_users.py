from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import AdminUserDep
from app.auth.sessions import revoke_all_sessions
from app.db import get_pool
from app.repositories import access_repository, users_repository
from app.schemas.users import UserCreate, UserMailboxAccessEntry, UserRead, UserUpdate

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("", response_model=list[UserRead])
async def list_users(pool: PoolDep, _admin: AdminUserDep) -> list[UserRead]:
    records = await users_repository.list_users(pool)
    return [UserRead(**dict(r)) for r in records]


@router.post("", response_model=UserRead, status_code=http_status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, pool: PoolDep, admin: AdminUserDep) -> UserRead:
    existing = await users_repository.get_user_by_email(pool, payload.email_address)
    if existing is not None:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Ya existe un usuario con ese email")
    record = await users_repository.create_user(
        pool,
        email_address=payload.email_address,
        display_name=payload.display_name,
        role=payload.role,
        created_by_user_id=admin.user_id,
    )
    return UserRead(**dict(record))


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(user_id: int, payload: UserUpdate, pool: PoolDep, _admin: AdminUserDep) -> UserRead:
    record = await users_repository.update_user(
        pool, user_id, display_name=payload.display_name, role=payload.role, enabled=payload.enabled
    )
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    if payload.enabled is False:
        await revoke_all_sessions(pool, user_id)
    return UserRead(**dict(record))


@router.get("/{user_id}/mailboxes", response_model=list[UserMailboxAccessEntry])
async def list_user_mailboxes(user_id: int, pool: PoolDep, _admin: AdminUserDep) -> list[UserMailboxAccessEntry]:
    records = await access_repository.list_user_mailbox_access(pool, user_id)
    return [UserMailboxAccessEntry(**dict(r)) for r in records]
