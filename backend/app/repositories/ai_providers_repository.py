import asyncpg

_FIELDS = (
    "provider_id, label, provider_type, base_url, model, num_ctx, embeddings_model, api_key, "
    "is_chat_active, is_embeddings_active, created_at, updated_at"
)

# "chat" = usado para preguntas/analisis de expedientes, "embeddings" = usado
# para busqueda semantica (ver migracion 20260805_0002). El nombre de columna
# nunca viaja libre desde afuera -- role llega validado como Literal a nivel
# de schema Pydantic antes de tocar este modulo, y este dict es la unica
# fuente de nombres de columna interpolables.
_ROLE_COLUMNS = {"chat": "is_chat_active", "embeddings": "is_embeddings_active"}


def _role_column(role: str) -> str:
    try:
        return _ROLE_COLUMNS[role]
    except KeyError:
        raise ValueError(f"Rol de proveedor desconocido: {role!r}") from None


async def list_providers(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    query = f"SELECT {_FIELDS} FROM mailing.ai_providers ORDER BY created_at ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def get_provider(pool: asyncpg.Pool, provider_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM mailing.ai_providers WHERE provider_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, provider_id)


async def get_role_active_provider(pool: asyncpg.Pool, role: str) -> asyncpg.Record | None:
    column = _role_column(role)
    query = f"SELECT {_FIELDS} FROM mailing.ai_providers WHERE {column} LIMIT 1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)


async def create_provider(
    pool: asyncpg.Pool,
    *,
    label: str,
    provider_type: str,
    base_url: str | None,
    model: str,
    num_ctx: int,
    embeddings_model: str,
    api_key: str | None,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO mailing.ai_providers (label, provider_type, base_url, model, num_ctx, embeddings_model, api_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            query, label, provider_type, base_url, model, num_ctx, embeddings_model, api_key
        )


async def update_provider(
    pool: asyncpg.Pool,
    provider_id: int,
    *,
    label: str,
    provider_type: str,
    base_url: str | None,
    model: str,
    num_ctx: int,
    embeddings_model: str,
    api_key: str | None,
    keep_existing_api_key: bool,
) -> asyncpg.Record | None:
    if keep_existing_api_key:
        query = f"""
            UPDATE mailing.ai_providers
            SET label = $2, provider_type = $3, base_url = $4, model = $5, num_ctx = $6, embeddings_model = $7,
                updated_at = now()
            WHERE provider_id = $1
            RETURNING {_FIELDS};
        """
        async with pool.acquire() as conn:
            return await conn.fetchrow(
                query, provider_id, label, provider_type, base_url, model, num_ctx, embeddings_model
            )

    query = f"""
        UPDATE mailing.ai_providers
        SET label = $2, provider_type = $3, base_url = $4, model = $5, num_ctx = $6, embeddings_model = $7,
            api_key = $8, updated_at = now()
        WHERE provider_id = $1
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            query, provider_id, label, provider_type, base_url, model, num_ctx, embeddings_model, api_key
        )


async def delete_provider(pool: asyncpg.Pool, provider_id: int) -> bool:
    query = "DELETE FROM mailing.ai_providers WHERE provider_id = $1 RETURNING provider_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, provider_id)
    return row is not None


async def activate_role(pool: asyncpg.Pool, provider_id: int, role: str) -> asyncpg.Record | None:
    """Prende el rol (chat/embeddings) en provider_id y lo apaga en cualquier
    otro que lo tuviera -- a lo sumo un proveedor por rol, pero el otro rol de
    ese mismo proveedor (si lo tiene) no se toca."""
    column = _role_column(role)
    async with pool.acquire() as conn:
        async with conn.transaction():
            exists = await conn.fetchrow(
                "SELECT provider_id FROM mailing.ai_providers WHERE provider_id = $1;", provider_id
            )
            if exists is None:
                return None
            await conn.execute(f"UPDATE mailing.ai_providers SET {column} = false WHERE {column};")
            return await conn.fetchrow(
                f"""
                UPDATE mailing.ai_providers SET {column} = true, updated_at = now()
                WHERE provider_id = $1
                RETURNING {_FIELDS};
                """,
                provider_id,
            )


async def deactivate_role(pool: asyncpg.Pool, provider_id: int, role: str) -> asyncpg.Record | None:
    """Apaga el rol en provider_id sin activarlo en ningun otro -- deja ese
    rol sin proveedor asignado hasta que alguien active uno."""
    column = _role_column(role)
    query = f"""
        UPDATE mailing.ai_providers SET {column} = false, updated_at = now()
        WHERE provider_id = $1
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, provider_id)


async def get_policy(pool: asyncpg.Pool) -> str:
    query = "SELECT policy FROM mailing.ai_settings WHERE id = true;"
    async with pool.acquire() as conn:
        return await conn.fetchval(query)


async def set_policy(pool: asyncpg.Pool, policy: str) -> str:
    query = "UPDATE mailing.ai_settings SET policy = $1, updated_at = now() WHERE id = true RETURNING policy;"
    async with pool.acquire() as conn:
        return await conn.fetchval(query, policy)
