import asyncpg


async def get_output_file(pool: asyncpg.Pool, chart_id: int) -> str | None:
    query = "SELECT output_file FROM mailing.chart_runs WHERE chart_id = $1;"
    async with pool.acquire() as conn:
        record = await conn.fetchrow(query, chart_id)
    return record["output_file"] if record else None
