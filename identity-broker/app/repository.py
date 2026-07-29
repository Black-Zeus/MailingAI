from datetime import datetime

import asyncpg

_PUBLIC_FIELDS = (
    "mailbox_account_id, label, email_address, provider, enabled, "
    "token_expires_at, created_at, updated_at"
)
_TOKEN_FIELDS = (
    "mailbox_account_id, label, provider, tenant_id, client_id, client_secret, "
    "access_token, refresh_token, token_expires_at, enabled"
)


async def list_mailboxes(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    query = f"SELECT {_PUBLIC_FIELDS} FROM identity.mailbox_accounts ORDER BY created_at ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def get_mailbox_public(pool: asyncpg.Pool, mailbox_account_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_PUBLIC_FIELDS} FROM identity.mailbox_accounts WHERE mailbox_account_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id)


async def get_mailbox_for_token(pool: asyncpg.Pool, mailbox_account_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_TOKEN_FIELDS} FROM identity.mailbox_accounts WHERE mailbox_account_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id)


async def upsert_from_oauth(
    pool: asyncpg.Pool,
    *,
    label: str,
    email_address: str | None,
    provider: str,
    tenant_id: str,
    client_id: str,
    client_secret: str,
    access_token: str,
    refresh_token: str,
    token_expires_at: datetime,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO identity.mailbox_accounts
            (label, email_address, provider, tenant_id, client_id, client_secret,
             access_token, refresh_token, token_expires_at, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        ON CONFLICT (provider, email_address) WHERE email_address IS NOT NULL
        DO UPDATE SET
            label = EXCLUDED.label,
            tenant_id = EXCLUDED.tenant_id,
            client_id = EXCLUDED.client_id,
            client_secret = EXCLUDED.client_secret,
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            token_expires_at = EXCLUDED.token_expires_at,
            enabled = true,
            updated_at = now()
        RETURNING {_PUBLIC_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            query,
            label,
            email_address,
            provider,
            tenant_id,
            client_id,
            client_secret,
            access_token,
            refresh_token,
            token_expires_at,
        )


async def update_tokens(
    pool: asyncpg.Pool,
    mailbox_account_id: int,
    *,
    access_token: str,
    refresh_token: str,
    token_expires_at: datetime,
) -> None:
    query = """
        UPDATE identity.mailbox_accounts
        SET access_token = $2, refresh_token = $3, token_expires_at = $4, updated_at = now()
        WHERE mailbox_account_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, mailbox_account_id, access_token, refresh_token, token_expires_at)


async def update_mailbox(
    pool: asyncpg.Pool,
    mailbox_account_id: int,
    *,
    label: str | None,
    enabled: bool | None,
) -> asyncpg.Record | None:
    existing = await get_mailbox_public(pool, mailbox_account_id)
    if existing is None:
        return None
    next_label = label if label is not None else existing["label"]
    next_enabled = enabled if enabled is not None else existing["enabled"]
    query = f"""
        UPDATE identity.mailbox_accounts
        SET label = $2, enabled = $3, updated_at = now()
        WHERE mailbox_account_id = $1
        RETURNING {_PUBLIC_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id, next_label, next_enabled)


async def delete_mailbox(pool: asyncpg.Pool, mailbox_account_id: int) -> bool:
    query = "DELETE FROM identity.mailbox_accounts WHERE mailbox_account_id = $1 RETURNING mailbox_account_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, mailbox_account_id)
    return row is not None
