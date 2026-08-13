import re

import asyncpg
import httpx

from app.repositories import ai_providers_repository
from app.services.ai.base import ProviderUnavailableError
from app.services.markdown_render import html_to_ai_context, truncate_quoted_reply

# Dimension del modelo de embeddings soportado hoy (bge-m3). Si el dia de
# manana se activa el rol de embeddings con un modelo de otra dimension, la
# columna vector(1024) de mailing.message_chunk_embeddings necesita
# recrearse -- no hay forma de mezclar dimensiones distintas en la misma
# columna (ver migracion 20260805_0001).
EMBEDDING_DIM = 1024

# ~1250 / ~150 tokens (4 caracteres por token aprox, mismo criterio usado en
# todo el resto del modulo de IA). Chunks chicos hacen la recuperacion mas
# precisa -- un correo entero de 7000 tokens como un solo vector diluye
# cualquier hecho puntual que haya adentro. El solape evita perder contexto
# justo en el borde de un corte.
_CHUNK_TARGET_CHARS = 5000
_CHUNK_OVERLAP_CHARS = 600


async def get_embeddings_provider(pool: asyncpg.Pool) -> asyncpg.Record:
    """El proveedor con el rol de embeddings activo (ver migracion
    20260805_0002 y Configuracion > Integracion IA) -- independiente de cual
    proveedor este activo para chat, se elige por separado precisamente para
    poder cambiar de proveedor de chat (a ChatGPT, Claude, otro modelo en
    Ollama, lo que sea) sin que eso rompa la busqueda semantica."""
    provider = await ai_providers_repository.get_role_active_provider(pool, "embeddings")
    if provider is None or not provider["base_url"]:
        raise ProviderUnavailableError(
            "No hay ningun proveedor con el rol de embeddings activo -- configuralo en "
            "Configuración > Integración IA antes de hacer preguntas sobre expedientes grandes."
        )
    return provider


def chunk_text(
    text: str, *, target_chars: int = _CHUNK_TARGET_CHARS, overlap_chars: int = _CHUNK_OVERLAP_CHARS
) -> list[str]:
    """Trocea un texto largo en fragmentos embebibles, respetando parrafos
    (no corta una idea a la mitad si se puede evitar) y con solape entre
    fragmentos consecutivos. Un texto que ya entra en target_chars devuelve
    un unico chunk -- la mayoria de los correos (una respuesta corta, un
    aviso) nunca pasan por el troceo real."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= target_chars:
        return [text]

    paragraphs = re.split(r"\n\s*\n", text)
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= target_chars or not current:
            current = candidate
        else:
            chunks.append(current)
            tail = current[-overlap_chars:] if len(current) > overlap_chars else current
            current = f"{tail}\n\n{para}"
    if current:
        chunks.append(current)
    return chunks


async def embed_texts(base_url: str, model: str, texts: list[str]) -> list[list[float]]:
    """Genera un embedding por texto de entrada, en el mismo orden. Ollama
    acepta una lista completa en un solo request (mas eficiente que uno por
    uno para el troceo de un correo largo)."""
    if not texts:
        return []
    payload = {"model": model, "input": texts}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(f"{base_url}/api/embed", json=payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ProviderUnavailableError(f"No se pudo generar el embedding ({type(exc).__name__}): {exc}") from exc
    data = response.json()
    return data["embeddings"]


async def ensure_case_embeddings(pool: asyncpg.Pool, case_id: int, messages: list[asyncpg.Record]) -> None:
    """Genera embeddings para los correos del expediente que todavia no los
    tienen. Se llama justo antes de armar contexto por recuperacion (nunca al
    ingestar un correo) -- idempotente, y de paso cubre el backfill de
    expedientes que ya existian antes de esta funcionalidad: no hace falta
    un proceso aparte, la primera pregunta que necesite recuperacion sobre un
    expediente grande indexa lo que falte en el momento.

    messages debe traer body_content/body_content_type (el mismo shape que ya
    usa _build_case_qa_context) -- se reusa el mismo pipeline de extraccion y
    corte de citas para que lo que se embebe sea exactamente lo mismo que se
    mostraria en la via de contexto completo."""
    existing = await pool.fetch(
        "SELECT DISTINCT message_id FROM mailing.message_chunk_embeddings WHERE case_id = $1", case_id
    )
    already_indexed = {r["message_id"] for r in existing}
    pending = [m for m in messages if m["message_id"] not in already_indexed]
    if not pending:
        return

    provider = await get_embeddings_provider(pool)
    base_url = provider["base_url"].rstrip("/")
    model = provider["embeddings_model"]
    known_addresses = {m["from_address"].lower() for m in messages if m["from_address"]}
    known_names = {m["from_name"].strip().lower() for m in messages if m["from_name"]}

    for m in pending:
        raw_body = m["body_content"] or ""
        body = html_to_ai_context(raw_body) if m["body_content_type"] == "html" else raw_body.strip()
        body = truncate_quoted_reply(body, known_addresses, known_names)
        chunks = chunk_text(body)
        if not chunks:
            continue
        vectors = await embed_texts(base_url, model, chunks)
        async with pool.acquire() as conn:
            for idx, (chunk, vector) in enumerate(zip(chunks, vectors)):
                await conn.execute(
                    """
                    INSERT INTO mailing.message_chunk_embeddings
                        (case_id, message_id, chunk_index, chunk_text, embedding)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (message_id, chunk_index) DO NOTHING;
                    """,
                    case_id,
                    m["message_id"],
                    idx,
                    chunk,
                    vector,
                )


async def search_relevant_chunks(
    pool: asyncpg.Pool, case_id: int, query_embedding: list[float], top_k: int
) -> list[asyncpg.Record]:
    """Trae los top_k chunks del expediente mas parecidos semanticamente a
    query_embedding (distancia coseno, el mismo criterio que el indice HNSW),
    con los datos del correo de origen para poder mostrar la misma
    atribucion (remitente/fecha/asunto) que usa la via de contexto
    completo."""
    query = """
        SELECT mce.message_id, mce.chunk_index, mce.chunk_text,
               m.from_name, m.from_address, m.sent_datetime, m.subject,
               mce.embedding <=> $2 AS distance
        FROM mailing.message_chunk_embeddings mce
        JOIN mailing.messages m ON m.message_id = mce.message_id
        WHERE mce.case_id = $1
        ORDER BY mce.embedding <=> $2
        LIMIT $3;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id, query_embedding, top_k)
