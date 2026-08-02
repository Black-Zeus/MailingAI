from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth import passwords
from app.auth.dependencies import AdminUserDep
from app.auth.sessions import revoke_all_sessions
from app.db import get_pool
from app.repositories import access_repository, cases_repository, users_repository
from app.services import email_templates, notification_email_service
from app.schemas.users import (
    UserCreate,
    UserDeletionImpactRead,
    UserDeleteResponse,
    UserMailboxAccessEntry,
    UserPasswordReset,
    UserRead,
    UserUpdate,
)

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

    if payload.auth_method == "local":
        assert payload.username and payload.password  # ya validado en el schema (_validate_local_fields)
        existing_username = await users_repository.get_user_by_username(pool, payload.username)
        if existing_username is not None:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT, detail="Ya existe una cuenta local con ese usuario"
            )
        record = await users_repository.create_local_user(
            pool,
            username=payload.username,
            email_address=payload.email_address,
            display_name=payload.display_name,
            role=payload.role,
            password_hash=passwords.hash_password(payload.password),
            created_by_user_id=admin.user_id,
        )
    else:
        record = await users_repository.create_user(
            pool,
            email_address=payload.email_address,
            display_name=payload.display_name,
            role=payload.role,
            created_by_user_id=admin.user_id,
        )
    admin_name = admin.display_name or admin.email_address
    email_body = email_templates.render_account_created_email(
        recipient_name=payload.display_name,
        recipient_email=payload.email_address,
        role=payload.role,
        created_by=admin_name,
        auth_method=payload.auth_method,
        username=payload.username,
    )
    await notification_email_service.try_send_email(
        to_email=payload.email_address,
        subject="MailingAI — tu cuenta fue creada",
        body=email_body,
    )
    return UserRead(**dict(record))


@router.post("/{user_id}/reset-password", response_model=UserRead)
async def reset_user_password(user_id: int, payload: UserPasswordReset, pool: PoolDep, _admin: AdminUserDep) -> UserRead:
    """Solo aplica a cuentas locales -- una cuenta SSO no tiene contraseña que
    resetear. Deja must_change_password=true: la persona tiene que cambiarla
    de nuevo en su proximo login, la que fijo el admin es solo temporal."""
    user = await users_repository.get_user_by_id(pool, user_id)
    if user is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    if user["auth_method"] != "local":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST, detail="Esta cuenta no es local, no tiene contraseña."
        )
    record = await users_repository.set_password(
        pool, user_id, password_hash=passwords.hash_password(payload.new_password), must_change_password=True
    )
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    await revoke_all_sessions(pool, user_id)
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


@router.get("/{user_id}/deletion-impact", response_model=UserDeletionImpactRead)
async def get_user_deletion_impact(user_id: int, pool: PoolDep, _admin: AdminUserDep) -> UserDeletionImpactRead:
    cases_owned = await cases_repository.count_cases_owned_by(pool, user_id)
    return UserDeletionImpactRead(cases_owned=cases_owned)


@router.delete("/{user_id}", response_model=UserDeleteResponse)
async def delete_user(user_id: int, pool: PoolDep, admin: AdminUserDep) -> UserDeleteResponse:
    """Borra la cuenta de verdad (a diferencia de PATCH .../enabled=false).
    Sus expedientes no quedan huerfanos: se reasignan al admin que hizo la
    eliminacion, con el nombre del dueño original guardado en
    previous_owner_label para poder reasignarlos despues a quien corresponda
    (ver PATCH /api/cases/{case_id}/owner)."""
    if user_id == admin.user_id:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST, detail="No podés eliminar tu propia cuenta."
        )
    target = await users_repository.get_user_by_id(pool, user_id)
    if target is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    if target["role"] == "admin" and target["enabled"]:
        admins = await users_repository.list_enabled_admins(pool)
        if len(admins) <= 1:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="No se puede eliminar al único administrador habilitado.",
            )
    label = target["display_name"] or target["email_address"]
    cases_reassigned = await cases_repository.reassign_cases_from_deleted_user(
        pool, deleted_user_id=user_id, deleted_user_label=label, new_owner_user_id=admin.user_id
    )
    await revoke_all_sessions(pool, user_id)
    await users_repository.delete_user(pool, user_id)
    return UserDeleteResponse(cases_reassigned=cases_reassigned)


@router.get("/{user_id}/mailboxes", response_model=list[UserMailboxAccessEntry])
async def list_user_mailboxes(user_id: int, pool: PoolDep, _admin: AdminUserDep) -> list[UserMailboxAccessEntry]:
    records = await access_repository.list_user_mailbox_access(pool, user_id)
    return [UserMailboxAccessEntry(**dict(r)) for r in records]
