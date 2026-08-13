import json
from typing import Any

import asyncpg


async def insert_ai_run(
    pool: asyncpg.Pool,
    *,
    case_id: int | None,
    job_id: str | None,
    provider: str,
    model: str,
    policy: str,
    prompt_version: str,
    input_hash: str,
    output_json: dict[str, Any] | None,
    status: str,
    error_message: str | None,
    duration_ms: int | None,
) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.ai_runs
          (case_id, job_id, provider, model, policy, prompt_version, input_hash, output_json, status, error_message, duration_ms)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
        RETURNING ai_run_id, created_at;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            query,
            case_id,
            job_id,
            provider,
            model,
            policy,
            prompt_version,
            input_hash,
            json.dumps(output_json) if output_json is not None else None,
            status,
            error_message,
            duration_ms,
        )


async def update_ai_run(
    pool: asyncpg.Pool,
    ai_run_id: int,
    *,
    status: str,
    output_json: dict[str, Any] | None,
    error_message: str | None,
    duration_ms: int,
) -> None:
    """Actualiza la fila que start_case_analysis ya habia insertado en
    'running' -- se llama al terminar la llamada al proveedor de IA (exito,
    fallo, o error de validacion del JSON devuelto). Una sola fila por
    corrida real, igual que cuando todo era sincronico."""
    query = """
        UPDATE mailing.ai_runs
        SET status = $2, output_json = $3::jsonb, error_message = $4, duration_ms = $5
        WHERE ai_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(
            query,
            ai_run_id,
            status,
            json.dumps(output_json) if output_json is not None else None,
            error_message,
            duration_ms,
        )


async def fail_orphaned_ai_runs(pool: asyncpg.Pool) -> int:
    """Marca como 'failed' cualquier corrida que haya quedado 'running'.

    Se llama al arrancar el backend: si hay una fila asi, es porque el
    proceso que la estaba terminando (BackgroundTasks) murio junto con un
    reinicio/redeploy del contenedor -- nadie mas la va a terminar nunca.
    """
    query = """
        UPDATE mailing.ai_runs
        SET status = 'failed',
            error_message = 'Interrumpida por un reinicio del backend antes de terminar.'
        WHERE status = 'running'
        RETURNING ai_run_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)


async def get_latest_ai_run_by_case(pool: asyncpg.Pool, case_id: int) -> asyncpg.Record | None:
    query = """
        SELECT ai_run_id, provider, model, policy, status, output_json, error_message, created_at
        FROM mailing.ai_runs
        WHERE case_id = $1
        ORDER BY created_at DESC
        LIMIT 1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id)


async def get_case_messages_for_ai(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT m.subject, m.from_address, m.from_name, m.sent_datetime, m.body_preview
        FROM mailing.case_messages cm
        JOIN mailing.messages m ON m.message_id = cm.message_id
        WHERE cm.case_id = $1
        ORDER BY m.sent_datetime ASC NULLS LAST
        LIMIT 20;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def get_case_messages_with_body(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    """Como get_case_messages_for_ai, pero con el cuerpo completo del correo
    (body_content) en vez del preview de 600 caracteres -- usado por
    preguntas-respuesta sobre un expediente, donde el preview no alcanza
    para contestar algo puntual (ej. una direccion, quien confirmo algo).
    LIMIT generoso como valvula de seguridad, no un tope real para el uso
    normal (un expediente con mas de 300 correos ya es un caso atipico)."""
    query = """
        SELECT m.message_id, m.subject, m.from_address, m.from_name, m.sent_datetime,
               m.body_content, m.body_content_type
        FROM mailing.case_messages cm
        JOIN mailing.messages m ON m.message_id = cm.message_id
        WHERE cm.case_id = $1
        ORDER BY m.sent_datetime ASC NULLS LAST
        LIMIT 300;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)
