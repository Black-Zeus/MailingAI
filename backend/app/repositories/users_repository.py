import asyncpg

_FIELDS = (
    "user_id, ms_object_id, email_address, display_name, role, enabled, "
    "created_by_user_id, created_at, updated_at, last_login_at"
)


async def get_user_by_id(pool: asyncpg.Pool, user_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM identity.users WHERE user_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, user_id)


async def get_user_by_ms_object_id(pool: asyncpg.Pool, ms_object_id: str) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM identity.users WHERE ms_object_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, ms_object_id)


async def get_unlinked_user_by_email(pool: asyncpg.Pool, email_address: str) -> asyncpg.Record | None:
    query = f"""
        SELECT {_FIELDS} FROM identity.users
        WHERE lower(email_address) = lower($1) AND ms_object_id IS NULL;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, email_address)


async def link_ms_object_id(pool: asyncpg.Pool, user_id: int, ms_object_id: str) -> asyncpg.Record:
    query = f"""
        UPDATE identity.users
        SET ms_object_id = $2, last_login_at = now(), updated_at = now()
        WHERE user_id = $1
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, user_id, ms_object_id)


async def touch_last_login(pool: asyncpg.Pool, user_id: int) -> None:
    query = "UPDATE identity.users SET last_login_at = now() WHERE user_id = $1;"
    async with pool.acquire() as conn:
        await conn.execute(query, user_id)


async def list_users(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    query = f"SELECT {_FIELDS} FROM identity.users ORDER BY created_at ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def list_enabled_users(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    """Directorio minimo (sin role/ms_object_id/last_login) para que cualquier
    usuario logueado -- no solo un admin -- pueda elegir con quien compartir
    un expediente o buzon. list_users (arriba) trae todos los campos pero es
    admin-only; este es el que consume el picker de compartir."""
    query = """
        SELECT user_id, email_address, display_name
        FROM identity.users
        WHERE enabled = true
        ORDER BY COALESCE(display_name, email_address) ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def get_user_by_email(pool: asyncpg.Pool, email_address: str) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM identity.users WHERE lower(email_address) = lower($1);"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, email_address)


async def create_user(
    pool: asyncpg.Pool,
    *,
    email_address: str,
    display_name: str | None,
    role: str,
    created_by_user_id: int,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO identity.users (email_address, display_name, role, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, email_address, display_name, role, created_by_user_id)


async def find_or_link_by_oauth(pool: asyncpg.Pool, *, ms_object_id: str, email_address: str) -> asyncpg.Record | None:
    """Resuelve el usuario que acaba de completar el login SSO. Nunca crea una
    cuenta nueva (alta exclusiva por un admin, ver app/api/admin_users.py):
    devuelve None si no hay ninguna fila pre-provisionada para ese email/oid,
    o si la que hay esta deshabilitada."""
    existing = await get_user_by_ms_object_id(pool, ms_object_id)
    if existing is None:
        pending = await get_unlinked_user_by_email(pool, email_address)
        if pending is not None:
            existing = await link_ms_object_id(pool, pending["user_id"], ms_object_id)
    if existing is None or not existing["enabled"]:
        return None
    await touch_last_login(pool, existing["user_id"])
    return existing


async def update_user(
    pool: asyncpg.Pool,
    user_id: int,
    *,
    display_name: str | None,
    role: str | None,
    enabled: bool | None,
) -> asyncpg.Record | None:
    existing = await get_user_by_id(pool, user_id)
    if existing is None:
        return None
    next_display_name = display_name if display_name is not None else existing["display_name"]
    next_role = role if role is not None else existing["role"]
    next_enabled = enabled if enabled is not None else existing["enabled"]
    query = f"""
        UPDATE identity.users
        SET display_name = $2, role = $3, enabled = $4, updated_at = now()
        WHERE user_id = $1
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, user_id, next_display_name, next_role, next_enabled)
