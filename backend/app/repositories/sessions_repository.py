from datetime import datetime

import asyncpg


async def insert_session(
    pool: asyncpg.Pool,
    *,
    session_token_hash: str,
    user_id: int,
    expires_at: datetime,
    user_agent: str | None,
    ip_address: str | None,
) -> None:
    query = """
        INSERT INTO identity.user_sessions
            (session_token_hash, user_id, expires_at, user_agent, ip_address)
        VALUES ($1, $2, $3, $4, $5);
    """
    async with pool.acquire() as conn:
        await conn.execute(query, session_token_hash, user_id, expires_at, user_agent, ip_address)


async def get_active_session(pool: asyncpg.Pool, session_token_hash: str) -> asyncpg.Record | None:
    query = """
        SELECT s.session_token_hash, s.expires_at, s.created_at,
               u.user_id, u.email_address, u.display_name, u.role, u.enabled, u.must_change_password
        FROM identity.user_sessions s
        JOIN identity.users u ON u.user_id = s.user_id
        WHERE s.session_token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now();
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, session_token_hash)


async def touch_session(pool: asyncpg.Pool, session_token_hash: str, *, expires_at: datetime) -> None:
    query = """
        UPDATE identity.user_sessions
        SET last_seen_at = now(), expires_at = $2
        WHERE session_token_hash = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, session_token_hash, expires_at)


async def revoke_session(pool: asyncpg.Pool, session_token_hash: str) -> None:
    query = """
        UPDATE identity.user_sessions
        SET revoked_at = now()
        WHERE session_token_hash = $1 AND revoked_at IS NULL;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, session_token_hash)


async def revoke_all_sessions_for_user(pool: asyncpg.Pool, user_id: int) -> None:
    query = """
        UPDATE identity.user_sessions
        SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, user_id)
