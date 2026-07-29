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
    duration_ms: int,
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
