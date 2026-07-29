from datetime import datetime

import asyncpg

_PUBLIC_FIELDS = (
    "mailbox_account_id, label, email_address, provider, enabled, "
    "token_expires_at, created_at, updated_at, owner_user_id, is_notification_sender"
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


class MailboxAlreadyOwnedError(Exception):
    """La cuenta ya tiene un dueño distinto y no se pidio forzar el cambio."""


async def claim_mailbox_owner(
    pool: asyncpg.Pool, mailbox_account_id: int, *, owner_user_id: int, force: bool
) -> asyncpg.Record | None:
    existing = await get_mailbox_public(pool, mailbox_account_id)
    if existing is None:
        return None
    if existing["owner_user_id"] is not None and existing["owner_user_id"] != owner_user_id and not force:
        raise MailboxAlreadyOwnedError(mailbox_account_id)
    query = f"""
        UPDATE identity.mailbox_accounts
        SET owner_user_id = $2, updated_at = now()
        WHERE mailbox_account_id = $1
        RETURNING {_PUBLIC_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id, owner_user_id)


async def clear_mailbox_owner(pool: asyncpg.Pool, mailbox_account_id: int) -> asyncpg.Record | None:
    """Usado por un admin para liberar un buzon (queda sin dueño otra vez,
    igual que uno preexistente sin migrar) -- ej. antes de reasignarlo, o si
    el dueño actual ya no debe tener acceso."""
    query = f"""
        UPDATE identity.mailbox_accounts
        SET owner_user_id = NULL, updated_at = now()
        WHERE mailbox_account_id = $1
        RETURNING {_PUBLIC_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id)


async def get_notification_sender(pool: asyncpg.Pool) -> asyncpg.Record | None:
    query = f"SELECT {_PUBLIC_FIELDS} FROM identity.mailbox_accounts WHERE is_notification_sender LIMIT 1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)


async def set_notification_sender(pool: asyncpg.Pool, mailbox_account_id: int | None) -> asyncpg.Record | None:
    """mailbox_account_id=None limpia el remitente de notificaciones (queda
    sin ninguno). Transaccional: nunca deja mas de un buzon marcado."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE identity.mailbox_accounts SET is_notification_sender = false WHERE is_notification_sender;"
            )
            if mailbox_account_id is None:
                return None
            return await conn.fetchrow(
                f"""
                UPDATE identity.mailbox_accounts
                SET is_notification_sender = true, updated_at = now()
                WHERE mailbox_account_id = $1
                RETURNING {_PUBLIC_FIELDS};
                """,
                mailbox_account_id,
            )


async def upsert_mailbox_share(
    pool: asyncpg.Pool, *, mailbox_account_id: int, user_id: int, permission: str, shared_by_user_id: int
) -> asyncpg.Record:
    query = """
        WITH upserted AS (
            INSERT INTO identity.mailbox_shares (mailbox_account_id, user_id, permission, shared_by_user_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (mailbox_account_id, user_id) DO UPDATE SET
                permission = EXCLUDED.permission,
                shared_by_user_id = EXCLUDED.shared_by_user_id
            RETURNING mailbox_account_id, user_id, permission, shared_by_user_id, created_at
        )
        SELECT upserted.*, u.email_address, u.display_name
        FROM upserted JOIN identity.users u ON u.user_id = upserted.user_id;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id, user_id, permission, shared_by_user_id)


async def list_mailbox_shares(pool: asyncpg.Pool, mailbox_account_id: int) -> list[asyncpg.Record]:
    # JOIN de solo lectura contra identity.users -- identity-broker no
    # administra esa tabla (la escritura es exclusiva del backend, ver
    # 20260729_0001), pero leerla para mostrar email/nombre en la lista de
    # comparticiones es el mismo criterio que ya usa el backend al leer
    # identity.mailbox_accounts directo por SQL.
    query = """
        SELECT ms.mailbox_account_id, ms.user_id, ms.permission, ms.shared_by_user_id, ms.created_at,
               u.email_address, u.display_name
        FROM identity.mailbox_shares ms
        JOIN identity.users u ON u.user_id = ms.user_id
        WHERE ms.mailbox_account_id = $1
        ORDER BY ms.created_at ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, mailbox_account_id)


async def delete_mailbox_share(pool: asyncpg.Pool, mailbox_account_id: int, user_id: int) -> bool:
    query = """
        DELETE FROM identity.mailbox_shares
        WHERE mailbox_account_id = $1 AND user_id = $2
        RETURNING user_id;
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, mailbox_account_id, user_id)
    return row is not None
