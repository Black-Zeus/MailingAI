import asyncpg


async def check_postgres(pool: asyncpg.Pool) -> bool:
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1;")
        return True
    except Exception:
        return False


async def get_stats(pool: asyncpg.Pool) -> asyncpg.Record:
    query = """
        SELECT
          (SELECT count(*) FROM mailing.messages) AS message_count,
          (SELECT count(*) FROM mailing.message_attachments) AS attachment_count,
          (SELECT count(*) FROM mailing.v_conversation_summary) AS conversation_count,
          (SELECT count(*) FROM mailing.cases) AS case_count;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)
