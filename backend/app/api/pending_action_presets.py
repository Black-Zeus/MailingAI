from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.schemas.pending_action_presets import PendingActionPresetCreate, PendingActionPresetRead
from app.services import pending_action_presets_service

router = APIRouter(prefix="/api/pending-action-presets", tags=["pending-action-presets"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("", response_model=list[PendingActionPresetRead])
async def list_pending_action_presets(pool: PoolDep, _user: CurrentUserDep) -> list[PendingActionPresetRead]:
    """Recurso de equipo: cualquier usuario ve todas las frases, no solo las
    propias -- mismo criterio que mail_templates."""
    return await pending_action_presets_service.list_presets(pool)


@router.post("", response_model=PendingActionPresetRead, status_code=http_status.HTTP_201_CREATED)
async def create_pending_action_preset(
    payload: PendingActionPresetCreate, pool: PoolDep, user: CurrentUserDep
) -> PendingActionPresetRead:
    return await pending_action_presets_service.create_preset(pool, text=payload.text, created_by_user_id=user.user_id)


@router.delete("/{preset_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_pending_action_preset(preset_id: int, pool: PoolDep, _user: CurrentUserDep) -> None:
    deleted = await pending_action_presets_service.delete_preset(pool, preset_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Frase no encontrada")
