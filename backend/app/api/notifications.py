from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.repositories import notifications_repository
from app.schemas.notifications import NotificationRead, UnreadCountResponse

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("", response_model=list[NotificationRead])
async def list_notifications(pool: PoolDep, user: CurrentUserDep) -> list[NotificationRead]:
    records = await notifications_repository.list_notifications(pool, user.user_id)
    return [NotificationRead(**dict(r)) for r in records]


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(pool: PoolDep, user: CurrentUserDep) -> UnreadCountResponse:
    return UnreadCountResponse(unread=await notifications_repository.count_unread(pool, user.user_id))


@router.post("/{notification_id}/read", status_code=http_status.HTTP_204_NO_CONTENT)
async def mark_read(notification_id: int, pool: PoolDep, user: CurrentUserDep) -> None:
    marked = await notifications_repository.mark_read(pool, notification_id, user.user_id)
    if not marked:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Notificación no encontrada")


@router.post("/read-all", status_code=http_status.HTTP_204_NO_CONTENT)
async def mark_all_read(pool: PoolDep, user: CurrentUserDep) -> None:
    await notifications_repository.mark_all_read(pool, user.user_id)


@router.delete("", status_code=http_status.HTTP_200_OK)
async def delete_all_notifications(pool: PoolDep, user: CurrentUserDep) -> dict[str, int]:
    deleted = await notifications_repository.delete_all(pool, user.user_id)
    return {"deleted": deleted}
