import asyncpg

from app.repositories import pending_action_presets_repository
from app.schemas.pending_action_presets import PendingActionPresetRead


def _to_preset(record: asyncpg.Record) -> PendingActionPresetRead:
    return PendingActionPresetRead(
        preset_id=record["preset_id"],
        text=record["text"],
        created_by_user_id=record["created_by_user_id"],
        created_at=record["created_at"],
    )


async def list_presets(pool: asyncpg.Pool) -> list[PendingActionPresetRead]:
    records = await pending_action_presets_repository.list_presets(pool)
    return [_to_preset(r) for r in records]


async def create_preset(pool: asyncpg.Pool, *, text: str, created_by_user_id: int) -> PendingActionPresetRead:
    record = await pending_action_presets_repository.create_preset(pool, text=text, created_by_user_id=created_by_user_id)
    return _to_preset(record)


async def delete_preset(pool: asyncpg.Pool, preset_id: int) -> bool:
    return await pending_action_presets_repository.delete_preset(pool, preset_id)
