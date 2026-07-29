import asyncpg

_FIELDS = "provider_id, label, provider_type, base_url, model, api_key, is_active, created_at, updated_at"


async def list_providers(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    query = f"SELECT {_FIELDS} FROM mailing.ai_providers ORDER BY created_at ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def get_provider(pool: asyncpg.Pool, provider_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM mailing.ai_providers WHERE provider_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, provider_id)


async def get_active_provider(pool: asyncpg.Pool) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM mailing.ai_providers WHERE is_active LIMIT 1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)


async def create_provider(
    pool: asyncpg.Pool,
    *,
    label: str,
    provider_type: str,
    base_url: str | None,
    model: str,
    api_key: str | None,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO mailing.ai_providers (label, provider_type, base_url, model, api_key)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, label, provider_type, base_url, model, api_key)


async def update_provider(
    pool: asyncpg.Pool,
    provider_id: int,
    *,
    label: str,
    provider_type: str,
    base_url: str | None,
    model: str,
    api_key: str | None,
    keep_existing_api_key: bool,
) -> asyncpg.Record | None:
    if keep_existing_api_key:
        query = f"""
            UPDATE mailing.ai_providers
            SET label = $2, provider_type = $3, base_url = $4, model = $5, updated_at = now()
            WHERE provider_id = $1
            RETURNING {_FIELDS};
        """
        async with pool.acquire() as conn:
            return await conn.fetchrow(query, provider_id, label, provider_type, base_url, model)

    query = f"""
        UPDATE mailing.ai_providers
        SET label = $2, provider_type = $3, base_url = $4, model = $5, api_key = $6, updated_at = now()
        WHERE provider_id = $1
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, provider_id, label, provider_type, base_url, model, api_key)


async def delete_provider(pool: asyncpg.Pool, provider_id: int) -> bool:
    query = "DELETE FROM mailing.ai_providers WHERE provider_id = $1 RETURNING provider_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, provider_id)
    return row is not None


async def set_active_provider(pool: asyncpg.Pool, provider_id: int) -> asyncpg.Record | None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            exists = await conn.fetchrow(
                "SELECT provider_id FROM mailing.ai_providers WHERE provider_id = $1;", provider_id
            )
            if exists is None:
                return None
            await conn.execute("UPDATE mailing.ai_providers SET is_active = false WHERE is_active;")
            return await conn.fetchrow(
                f"""
                UPDATE mailing.ai_providers SET is_active = true, updated_at = now()
                WHERE provider_id = $1
                RETURNING {_FIELDS};
                """,
                provider_id,
            )


async def get_policy(pool: asyncpg.Pool) -> str:
    query = "SELECT policy FROM mailing.ai_settings WHERE id = true;"
    async with pool.acquire() as conn:
        return await conn.fetchval(query)


async def set_policy(pool: asyncpg.Pool, policy: str) -> str:
    query = "UPDATE mailing.ai_settings SET policy = $1, updated_at = now() WHERE id = true RETURNING policy;"
    async with pool.acquire() as conn:
        return await conn.fetchval(query, policy)
