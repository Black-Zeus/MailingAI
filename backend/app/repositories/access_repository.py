import asyncpg

from app.auth.dependencies import CurrentUser


async def resolve_accessible_mailbox_ids(pool: asyncpg.Pool, user: CurrentUser) -> list[int] | None:
    """None = sin restriccion (admin, ve todos los buzones). Para el resto,
    la lista real (posiblemente vacia) de buzones propios + compartidos."""
    if user.is_admin:
        return None
    return await get_accessible_mailbox_ids(pool, user.user_id)


async def get_accessible_mailbox_ids(pool: asyncpg.Pool, user_id: int) -> list[int]:
    """Buzones propios + compartidos con este usuario. Se calcula una vez por
    request y se pasa hacia abajo a cada repositorio que filtra mensajes o
    correlaciona expedientes -- nunca se llama a Graph ni al identity-broker
    aca, es una lectura directa sobre identity.* (mismo criterio ya usado en
    messages_repository, que hace JOIN con identity.mailbox_accounts)."""
    query = """
        SELECT mailbox_account_id FROM identity.mailbox_accounts WHERE owner_user_id = $1
        UNION
        SELECT mailbox_account_id FROM identity.mailbox_shares WHERE user_id = $1;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id)
    return [r["mailbox_account_id"] for r in rows]


async def list_user_mailbox_access(pool: asyncpg.Pool, user_id: int) -> list[asyncpg.Record]:
    """Buzones a los que este usuario tiene acceso, con el motivo (dueño o
    compartido). Lo usa la ficha de usuario en el panel de administracion
    para poder compartirle/quitarle buzones desde ahi. Lectura directa sobre
    identity.* (mismo criterio que get_accessible_mailbox_ids)."""
    query = """
        SELECT ma.mailbox_account_id, ma.label, ma.email_address, ma.enabled,
               CASE WHEN ma.owner_user_id = $1 THEN 'owner' ELSE ms.permission END AS relation
        FROM identity.mailbox_accounts ma
        LEFT JOIN identity.mailbox_shares ms ON ms.mailbox_account_id = ma.mailbox_account_id AND ms.user_id = $1
        WHERE ma.owner_user_id = $1 OR ms.user_id = $1
        ORDER BY ma.label;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, user_id)
