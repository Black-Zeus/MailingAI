import asyncpg

_FIELDS = "preset_id, text, created_by_user_id, created_at"


async def list_presets(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    query = f"SELECT {_FIELDS} FROM mailing.pending_action_presets ORDER BY created_at ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def create_preset(pool: asyncpg.Pool, *, text: str, created_by_user_id: int) -> asyncpg.Record:
    query = f"""
        INSERT INTO mailing.pending_action_presets (text, created_by_user_id)
        VALUES ($1, $2)
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, text, created_by_user_id)


async def delete_preset(pool: asyncpg.Pool, preset_id: int) -> bool:
    query = "DELETE FROM mailing.pending_action_presets WHERE preset_id = $1 RETURNING preset_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, preset_id)
    return row is not None
