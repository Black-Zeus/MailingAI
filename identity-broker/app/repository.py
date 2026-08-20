from datetime import datetime

import asyncpg

from app.crypto import decrypt_token, encrypt_token

_PUBLIC_FIELDS = (
    "mailbox_account_id, label, email_address, provider, enabled, "
    "token_expires_at, created_at, updated_at, owner_user_id, is_notification_sender, tenant_config_id"
)
_TOKEN_FIELDS = (
    "mailbox_account_id, label, provider, tenant_id, client_id, client_secret, "
    "access_token, refresh_token, token_expires_at, enabled"
)


async def get_session_role(pool: asyncpg.Pool, session_token_hash: str) -> str | None:
    """Misma tabla que usa el backend (identity.user_sessions) -- el broker
    comparte la misma base Postgres, asi que puede validar la sesion admin
    del navegador sin ida y vuelta al backend. Devuelve el rol si la sesion
    esta activa y no vencida, o None."""
    query = """
        SELECT u.role
        FROM identity.user_sessions s
        JOIN identity.users u ON u.user_id = s.user_id
        WHERE s.session_token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.enabled;
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, session_token_hash)
        return row["role"] if row else None


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
        row = await conn.fetchrow(query, mailbox_account_id)
    if row is None:
        return row
    return {
        **row,
        "access_token": decrypt_token(row["access_token"]),
        "refresh_token": decrypt_token(row["refresh_token"]) if row["refresh_token"] else "",
    }


async def upsert_from_oauth(
    pool: asyncpg.Pool,
    *,
    label: str,
    email_address: str | None,
    provider: str,
    tenant_id: str,
    client_id: str,
    client_secret: str,
    tenant_config_id: int | None,
    access_token: str,
    refresh_token: str,
    token_expires_at: datetime,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO identity.mailbox_accounts
            (label, email_address, provider, tenant_id, client_id, client_secret, tenant_config_id,
             access_token, refresh_token, token_expires_at, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
        ON CONFLICT (provider, email_address) WHERE email_address IS NOT NULL
        DO UPDATE SET
            label = EXCLUDED.label,
            tenant_id = EXCLUDED.tenant_id,
            client_id = EXCLUDED.client_id,
            client_secret = EXCLUDED.client_secret,
            tenant_config_id = EXCLUDED.tenant_config_id,
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
            tenant_config_id,
            encrypt_token(access_token),
            encrypt_token(refresh_token),
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
        await conn.execute(
            query, mailbox_account_id, encrypt_token(access_token), encrypt_token(refresh_token), token_expires_at
        )


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


async def assign_mailbox_tenant(
    pool: asyncpg.Pool,
    mailbox_account_id: int,
    *,
    tenant_config_id: int,
    tenant_id: str,
    client_id: str,
    client_secret: str,
) -> asyncpg.Record | None:
    """Re-apunta un buzon YA conectado a otro tenant registrado -- copia las
    credenciales reales del tenant elegido (tenant_id/client_id/client_secret)
    hacia la fila del buzon, no solo el FK de trazabilidad. Sin esto, el FK
    quedaria mostrando un tenant distinto al que realmente usa el refresh de
    token (ver _get_valid_token), un estado inconsistente y confuso. Los
    tokens de acceso/refresh existentes NO se tocan -- si el buzon estaba
    conectado de verdad contra otro tenant de Microsoft, el proximo refresh
    va a fallar (ver docs/AZURE_SETUP.md); reasignar solo tiene sentido
    cuando el buzon en realidad ya pertenece al tenant elegido."""
    query = f"""
        UPDATE identity.mailbox_accounts
        SET tenant_config_id = $2, tenant_id = $3, client_id = $4, client_secret = $5, updated_at = now()
        WHERE mailbox_account_id = $1
        RETURNING {_PUBLIC_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id, tenant_config_id, tenant_id, client_id, client_secret)


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


_TENANT_CONFIG_PUBLIC_FIELDS = (
    "tenant_config_id, label, ms_tenant_id, ms_client_id, "
    "(ms_client_secret IS NOT NULL AND ms_client_secret != '') AS has_client_secret, "
    "is_active, created_at, updated_at"
)


async def count_tenant_configs(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT count(*) FROM identity.tenant_configs;")


async def list_tenant_configs(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    query = f"SELECT {_TENANT_CONFIG_PUBLIC_FIELDS} FROM identity.tenant_configs ORDER BY created_at ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def get_tenant_config_public(pool: asyncpg.Pool, tenant_config_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_TENANT_CONFIG_PUBLIC_FIELDS} FROM identity.tenant_configs WHERE tenant_config_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, tenant_config_id)


async def get_tenant_config_for_oauth(pool: asyncpg.Pool, tenant_config_id: int) -> asyncpg.Record | None:
    """Unica funcion que devuelve el client_secret real -- solo para armar la
    URL de autorizacion / intercambiar el codigo por tokens, nunca expuesta
    por API (ver TenantConfigRead.has_client_secret)."""
    query = """
        SELECT tenant_config_id, ms_tenant_id, ms_client_id, ms_client_secret
        FROM identity.tenant_configs WHERE tenant_config_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, tenant_config_id)


async def insert_tenant_config(
    pool: asyncpg.Pool,
    *,
    label: str,
    ms_tenant_id: str,
    ms_client_id: str,
    ms_client_secret: str,
    is_active: bool,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO identity.tenant_configs (label, ms_tenant_id, ms_client_id, ms_client_secret, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {_TENANT_CONFIG_PUBLIC_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, label, ms_tenant_id, ms_client_id, ms_client_secret, is_active)


async def update_tenant_config(
    pool: asyncpg.Pool,
    tenant_config_id: int,
    *,
    label: str | None,
    ms_tenant_id: str | None,
    ms_client_id: str | None,
    ms_client_secret: str | None,
    is_active: bool | None,
) -> asyncpg.Record | None:
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT label, ms_tenant_id, ms_client_id, ms_client_secret, is_active "
            "FROM identity.tenant_configs WHERE tenant_config_id = $1;",
            tenant_config_id,
        )
        if existing is None:
            return None
        query = f"""
            UPDATE identity.tenant_configs
            SET label = $2, ms_tenant_id = $3, ms_client_id = $4, ms_client_secret = $5, is_active = $6, updated_at = now()
            WHERE tenant_config_id = $1
            RETURNING {_TENANT_CONFIG_PUBLIC_FIELDS};
        """
        return await conn.fetchrow(
            query,
            tenant_config_id,
            label if label is not None else existing["label"],
            ms_tenant_id if ms_tenant_id is not None else existing["ms_tenant_id"],
            ms_client_id if ms_client_id is not None else existing["ms_client_id"],
            ms_client_secret if ms_client_secret is not None else existing["ms_client_secret"],
            is_active if is_active is not None else existing["is_active"],
        )


async def delete_tenant_config(pool: asyncpg.Pool, tenant_config_id: int) -> bool:
    query = "DELETE FROM identity.tenant_configs WHERE tenant_config_id = $1 RETURNING tenant_config_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, tenant_config_id)
    return row is not None
