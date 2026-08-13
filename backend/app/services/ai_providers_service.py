from typing import Literal

import asyncpg

from app.repositories import ai_providers_repository
from app.schemas.ai_providers import AIPolicy, AIProviderCreate, AIProviderRead, AIProviderUpdate
from app.services.ai import embeddings_service
from app.services.ai.base import ProviderUnavailableError
from app.services.ai.factory import get_provider_instance
from app.services.ai.ollama_provider import OllamaProvider

ProviderRole = Literal["chat", "embeddings"]


class InvalidProviderConfigError(Exception):
    """Los datos del proveedor no alcanzan para poder usarlo (falta base_url o api_key segun el tipo,
    o se intento activar el rol de embeddings en un proveedor que no es ollama)."""


class PolicyBlocksProviderError(Exception):
    """La politica actual ('local_only') no permite activar este proveedor para el rol de chat."""


# Proveedores que corren en infraestructura propia (Ollama autohospedado, sea
# en este equipo o en un servidor de la red corporativa) -- nunca mandan el
# contenido a un tercero. Cualquier otro tipo se considera "externo" para la
# politica de IA, sin importar donde este desplegado.
_LOCAL_PROVIDERS = {"ollama"}

# El rol de embeddings queda restringido a Ollama propio -- decision
# deliberada, no una limitacion temporal:
# - Privacidad: mandar el cuerpo de los correos a un tercero para generar
#   embeddings es el mismo tipo de decision que ya cubre la politica
#   local_only/allow_external para el rol de chat -- no tiene sentido una
#   regla aparte que la esquive.
# - Claude/Anthropic ni siquiera tiene API de embeddings propia (recomiendan
#   Voyage AI aparte), asi que "activar Claude para embeddings" nunca podria
#   funcionar sin importar la politica.
# - La dimension del vector queda fija en la columna de Postgres
#   (vector(1024), ver migracion 20260805_0001) -- un proveedor externo
#   (ej. OpenAI, 1536 o 3072 dim segun el modelo) implicaria migrar y
#   reindexar mailing.message_chunk_embeddings entero cada vez que se
#   cambie, no es un toggle simple.
_EMBEDDINGS_CAPABLE_TYPES = {"ollama"}


def is_local_provider_type(provider_type: str) -> bool:
    return provider_type in _LOCAL_PROVIDERS


def to_provider_read(record: asyncpg.Record) -> AIProviderRead:
    return AIProviderRead(
        provider_id=record["provider_id"],
        label=record["label"],
        provider_type=record["provider_type"],
        base_url=record["base_url"],
        model=record["model"],
        num_ctx=record["num_ctx"],
        embeddings_model=record["embeddings_model"],
        has_api_key=bool(record["api_key"]),
        is_chat_active=record["is_chat_active"],
        is_embeddings_active=record["is_embeddings_active"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


def _validate(provider_type: str, base_url: str | None, api_key_present: bool) -> None:
    if provider_type == "ollama" and not base_url:
        raise InvalidProviderConfigError("Un proveedor Ollama necesita la URL del servidor (ej. http://192.168.1.50:11434).")
    if provider_type in ("openai", "anthropic") and not api_key_present:
        raise InvalidProviderConfigError(f"Un proveedor '{provider_type}' necesita una API key.")


async def _validate_model_accessible(
    provider_type: str, base_url: str | None, api_key: str | None, model: str
) -> None:
    """Confirma que 'model' este realmente entre los modelos que el proveedor
    reporta -- sin esto, un typo o un modelo borrado del servidor recien se
    nota cuando alguien hace una pregunta real (o peor, al activar el rol)."""
    try:
        provider = get_provider_instance(
            {"provider_type": provider_type, "base_url": base_url, "model": model, "api_key": api_key}
        )
        available = await provider.list_models()
    except ProviderUnavailableError as exc:
        raise InvalidProviderConfigError(f"No se pudo verificar el modelo '{model}': {exc}") from exc
    if model not in available:
        listado = ", ".join(available) if available else "(ninguno)"
        raise InvalidProviderConfigError(f"El modelo '{model}' no está disponible en este proveedor. Modelos encontrados: {listado}.")


async def _validate_embedding_model_accessible(base_url: str | None, model: str) -> None:
    """Como _validate_model_accessible, pero contra /api/tags filtrado a
    capability 'embedding' -- siempre Ollama (unico tipo soportado para este
    rol, ver _EMBEDDINGS_CAPABLE_TYPES)."""
    if not base_url:
        raise InvalidProviderConfigError("Se necesita la URL del servidor Ollama para verificar el modelo de embeddings.")
    try:
        available = await OllamaProvider(base_url, model="").list_embedding_models()
    except ProviderUnavailableError as exc:
        raise InvalidProviderConfigError(f"No se pudo verificar el modelo de embeddings '{model}': {exc}") from exc
    if model not in available:
        listado = ", ".join(available) if available else "(ninguno)"
        raise InvalidProviderConfigError(
            f"El modelo de embeddings '{model}' no está disponible (o no tiene capability 'embedding') en este "
            f"servidor Ollama. Modelos encontrados: {listado}."
        )


async def list_providers(pool: asyncpg.Pool) -> list[AIProviderRead]:
    records = await ai_providers_repository.list_providers(pool)
    return [to_provider_read(r) for r in records]


async def create_provider(pool: asyncpg.Pool, payload: AIProviderCreate) -> AIProviderRead:
    _validate(payload.provider_type, payload.base_url, bool(payload.api_key))
    await _validate_model_accessible(payload.provider_type, payload.base_url, payload.api_key, payload.model)
    if payload.provider_type == "ollama":
        await _validate_embedding_model_accessible(payload.base_url, payload.embeddings_model)
    record = await ai_providers_repository.create_provider(
        pool,
        label=payload.label,
        provider_type=payload.provider_type,
        base_url=payload.base_url,
        model=payload.model,
        num_ctx=payload.num_ctx,
        embeddings_model=payload.embeddings_model,
        api_key=payload.api_key,
    )
    return to_provider_read(record)


async def update_provider(pool: asyncpg.Pool, provider_id: int, payload: AIProviderUpdate) -> AIProviderRead | None:
    existing = await ai_providers_repository.get_provider(pool, provider_id)
    if existing is None:
        return None
    keep_existing_api_key = payload.api_key is None
    api_key_present = bool(payload.api_key) or (keep_existing_api_key and bool(existing["api_key"]))
    _validate(payload.provider_type, payload.base_url, api_key_present)

    # Solo se revalida contra el proveedor lo que realmente pudo haber
    # cambiado -- si nadie tocó el modelo ni la conexión (tipo/URL/API key),
    # repetir la llamada de red en cada guardado es puro costo sin
    # beneficio (y en el peor caso, bloquea un cambio de label/num_ctx
    # inocente si el servidor esta momentaneamente caido).
    effective_api_key = payload.api_key if payload.api_key is not None else existing["api_key"]
    connection_changed = (
        payload.provider_type != existing["provider_type"]
        or payload.base_url != existing["base_url"]
        or (payload.api_key is not None and payload.api_key != existing["api_key"])
    )
    if connection_changed or payload.model != existing["model"]:
        await _validate_model_accessible(payload.provider_type, payload.base_url, effective_api_key, payload.model)
    if payload.provider_type == "ollama" and (connection_changed or payload.embeddings_model != existing["embeddings_model"]):
        await _validate_embedding_model_accessible(payload.base_url, payload.embeddings_model)

    record = await ai_providers_repository.update_provider(
        pool,
        provider_id,
        label=payload.label,
        provider_type=payload.provider_type,
        base_url=payload.base_url,
        model=payload.model,
        num_ctx=payload.num_ctx,
        embeddings_model=payload.embeddings_model,
        api_key=payload.api_key,
        keep_existing_api_key=keep_existing_api_key,
    )
    return to_provider_read(record) if record else None


async def delete_provider(pool: asyncpg.Pool, provider_id: int) -> bool:
    return await ai_providers_repository.delete_provider(pool, provider_id)


async def activate_role(pool: asyncpg.Pool, provider_id: int, role: ProviderRole) -> AIProviderRead | None:
    """Prende un rol (chat/embeddings) en provider_id -- lo apaga en cualquier
    otro proveedor que lo tuviera, sin tocar el otro rol de ese mismo
    proveedor. No existe un "activar" generico: cada rol se pide por
    separado, asi que nunca queda un proveedor activo sin rol."""
    existing = await ai_providers_repository.get_provider(pool, provider_id)
    if existing is None:
        return None
    if role == "chat":
        policy = await ai_providers_repository.get_policy(pool)
        if policy == "local_only" and not is_local_provider_type(existing["provider_type"]):
            raise PolicyBlocksProviderError(
                f"La política 'Solo local' no permite usar '{existing['label']}' (proveedor externo) para chat. "
                "Cambia la política a 'Permitir proveedores externos' primero."
            )
    elif role == "embeddings":
        if existing["provider_type"] not in _EMBEDDINGS_CAPABLE_TYPES:
            raise InvalidProviderConfigError(
                f"'{existing['label']}' es un proveedor '{existing['provider_type']}' -- los embeddings solo "
                "se soportan contra un proveedor Ollama propio."
            )
        # La dimension del vector queda fija en la columna de Postgres al
        # crearla (vector(1024), ver migracion 20260805_0001) -- a diferencia
        # de num_ctx, no es un numero que Ollama simplemente acepte en cada
        # request. Si el modelo elegido genera otra dimension, mejor
        # bloquear la activacion con un error claro que dejar que la primera
        # pregunta real falle en silencio contra la tabla.
        try:
            [test_vector] = await embeddings_service.embed_texts(
                existing["base_url"].rstrip("/"), existing["embeddings_model"], ["test"]
            )
        except ProviderUnavailableError as exc:
            raise InvalidProviderConfigError(
                f"No se pudo generar un embedding de prueba con '{existing['embeddings_model']}' en "
                f"'{existing['label']}': {exc}"
            ) from exc
        if len(test_vector) != embeddings_service.EMBEDDING_DIM:
            raise InvalidProviderConfigError(
                f"El modelo '{existing['embeddings_model']}' genera vectores de {len(test_vector)} dimensiones, "
                f"pero mailing.message_chunk_embeddings espera {embeddings_service.EMBEDDING_DIM}. Cambiar de "
                "dimension requiere migrar esa tabla a mano antes de poder usar este modelo."
            )
    record = await ai_providers_repository.activate_role(pool, provider_id, role)
    return to_provider_read(record) if record else None


async def deactivate_role(pool: asyncpg.Pool, provider_id: int, role: ProviderRole) -> AIProviderRead | None:
    record = await ai_providers_repository.deactivate_role(pool, provider_id, role)
    return to_provider_read(record) if record else None


async def list_available_models(
    pool: asyncpg.Pool,
    *,
    provider_type: str,
    base_url: str | None,
    api_key: str | None,
    provider_id: int | None,
) -> list[str]:
    effective_api_key = api_key
    if not effective_api_key and provider_id is not None:
        existing = await ai_providers_repository.get_provider(pool, provider_id)
        if existing is not None:
            effective_api_key = existing["api_key"]
    provider = get_provider_instance(
        {"provider_type": provider_type, "base_url": base_url, "model": "", "api_key": effective_api_key}
    )
    return await provider.list_models()


async def list_available_embedding_models(base_url: str | None) -> list[str]:
    """Como list_available_models(), pero filtrado a modelos con capability
    'embedding' -- siempre contra Ollama (unico tipo soportado para este
    rol, ver _EMBEDDINGS_CAPABLE_TYPES), sin api_key."""
    if not base_url:
        raise InvalidProviderConfigError("Se necesita la URL del servidor Ollama para listar modelos de embeddings.")
    provider = OllamaProvider(base_url, model="")
    return await provider.list_embedding_models()


async def test_provider(pool: asyncpg.Pool, provider_id: int) -> bool | None:
    """None = el proveedor no existe. True/False = si respondio o no --
    a diferencia de gateway.health() (que solo prueba el proveedor de chat
    ACTIVO), esto sirve para cualquier proveedor configurado, tenga o no
    algun rol activo."""
    record = await ai_providers_repository.get_provider(pool, provider_id)
    if record is None:
        return None
    try:
        provider = get_provider_instance(record)
    except ProviderUnavailableError:
        return False
    return await provider.health_check()


async def get_policy(pool: asyncpg.Pool) -> AIPolicy:
    return await ai_providers_repository.get_policy(pool)


async def set_policy(pool: asyncpg.Pool, policy: AIPolicy) -> AIPolicy:
    return await ai_providers_repository.set_policy(pool, policy)
