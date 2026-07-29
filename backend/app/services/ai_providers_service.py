import asyncpg

from app.repositories import ai_providers_repository
from app.schemas.ai_providers import AIPolicy, AIProviderCreate, AIProviderRead, AIProviderUpdate
from app.services.ai.base import ProviderUnavailableError
from app.services.ai.factory import get_provider_instance


class InvalidProviderConfigError(Exception):
    """Los datos del proveedor no alcanzan para poder usarlo (falta base_url o api_key segun el tipo)."""


class PolicyBlocksProviderError(Exception):
    """La politica actual ('local_only') no permite activar este proveedor."""


# Proveedores que corren en infraestructura propia (Ollama autohospedado, sea
# en este equipo o en un servidor de la red corporativa) -- nunca mandan el
# contenido a un tercero. Cualquier otro tipo se considera "externo" para la
# politica de IA, sin importar donde este desplegado.
_LOCAL_PROVIDERS = {"ollama"}


def is_local_provider_type(provider_type: str) -> bool:
    return provider_type in _LOCAL_PROVIDERS


def to_provider_read(record: asyncpg.Record) -> AIProviderRead:
    return AIProviderRead(
        provider_id=record["provider_id"],
        label=record["label"],
        provider_type=record["provider_type"],
        base_url=record["base_url"],
        model=record["model"],
        has_api_key=bool(record["api_key"]),
        is_active=record["is_active"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


def _validate(provider_type: str, base_url: str | None, api_key_present: bool) -> None:
    if provider_type == "ollama" and not base_url:
        raise InvalidProviderConfigError("Un proveedor Ollama necesita la URL del servidor (ej. http://192.168.1.50:11434).")
    if provider_type in ("openai", "anthropic") and not api_key_present:
        raise InvalidProviderConfigError(f"Un proveedor '{provider_type}' necesita una API key.")


async def list_providers(pool: asyncpg.Pool) -> list[AIProviderRead]:
    records = await ai_providers_repository.list_providers(pool)
    return [to_provider_read(r) for r in records]


async def create_provider(pool: asyncpg.Pool, payload: AIProviderCreate) -> AIProviderRead:
    _validate(payload.provider_type, payload.base_url, bool(payload.api_key))
    record = await ai_providers_repository.create_provider(
        pool,
        label=payload.label,
        provider_type=payload.provider_type,
        base_url=payload.base_url,
        model=payload.model,
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
    record = await ai_providers_repository.update_provider(
        pool,
        provider_id,
        label=payload.label,
        provider_type=payload.provider_type,
        base_url=payload.base_url,
        model=payload.model,
        api_key=payload.api_key,
        keep_existing_api_key=keep_existing_api_key,
    )
    return to_provider_read(record) if record else None


async def delete_provider(pool: asyncpg.Pool, provider_id: int) -> bool:
    return await ai_providers_repository.delete_provider(pool, provider_id)


async def set_active_provider(pool: asyncpg.Pool, provider_id: int) -> AIProviderRead | None:
    existing = await ai_providers_repository.get_provider(pool, provider_id)
    if existing is None:
        return None
    policy = await ai_providers_repository.get_policy(pool)
    if policy == "local_only" and not is_local_provider_type(existing["provider_type"]):
        raise PolicyBlocksProviderError(
            f"La política 'Solo local' no permite activar '{existing['label']}' (proveedor externo). "
            "Cambia la política a 'Permitir proveedores externos' primero."
        )
    record = await ai_providers_repository.set_active_provider(pool, provider_id)
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


async def test_provider(pool: asyncpg.Pool, provider_id: int) -> bool | None:
    """None = el proveedor no existe. True/False = si respondio o no --
    a diferencia de gateway.health() (que solo prueba el proveedor ACTIVO),
    esto sirve para cualquier proveedor configurado, este activo o no."""
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
