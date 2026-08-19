import asyncpg

_FIELDS = "template_id, name, subject_template, body_template, active, created_by_user_id, created_at, updated_at"


async def create_template(
    pool: asyncpg.Pool,
    *,
    name: str,
    subject_template: str,
    body_template: str,
    created_by_user_id: int,
) -> asyncpg.Record:
    query = f"""
        INSERT INTO mailing.mail_templates (name, subject_template, body_template, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, name, subject_template, body_template, created_by_user_id)


async def list_templates(pool: asyncpg.Pool, *, active_only: bool = False) -> list[asyncpg.Record]:
    active_clause = "WHERE active" if active_only else ""
    query = f"SELECT {_FIELDS} FROM mailing.mail_templates {active_clause} ORDER BY name ASC;"
    async with pool.acquire() as conn:
        return await conn.fetch(query)


async def get_template(pool: asyncpg.Pool, template_id: int) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM mailing.mail_templates WHERE template_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, template_id)


_UPDATE_TEMPLATE_ALLOWED_COLUMNS = {"name", "subject_template", "body_template", "active"}


async def update_template(pool: asyncpg.Pool, template_id: int, *, fields: dict[str, object]) -> asyncpg.Record | None:
    unknown = set(fields) - _UPDATE_TEMPLATE_ALLOWED_COLUMNS
    if unknown:
        raise ValueError(f"Columnas no permitidas en update_template: {unknown}")
    if not fields:
        return await get_template(pool, template_id)

    params: list[object] = [template_id]
    set_clauses = []
    for key, value in fields.items():
        params.append(value)
        set_clauses.append(f"{key} = ${len(params)}")

    query = f"""
        UPDATE mailing.mail_templates
        SET {', '.join(set_clauses)}, updated_at = now()
        WHERE template_id = $1
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, *params)


async def delete_template(pool: asyncpg.Pool, template_id: int) -> bool:
    query = "DELETE FROM mailing.mail_templates WHERE template_id = $1 RETURNING template_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, template_id)
    return row is not None
