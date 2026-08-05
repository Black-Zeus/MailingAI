from typing import Mapping

from app.services.ai.anthropic_provider import AnthropicProvider
from app.services.ai.base import AIProvider, ProviderUnavailableError
from app.services.ai.ollama_provider import OllamaProvider
from app.services.ai.openai_provider import OpenAIProvider


def get_provider_instance(record: Mapping[str, object]) -> AIProvider:
    provider_type = record["provider_type"]
    model = record["model"]
    base_url = record["base_url"]
    api_key = record["api_key"]
    if provider_type == "ollama":
        # .get() en vez de record["num_ctx"]: list_available_models() arma un
        # dict ad-hoc sin ese campo (solo necesita listar modelos, no correr
        # una consulta real) -- OllamaProvider ya sabe usar su propio default
        # si viene None.
        return OllamaProvider(base_url or "http://ollama:11434", model, record.get("num_ctx"))
    if provider_type == "openai":
        if not api_key:
            raise ProviderUnavailableError("El proveedor OpenAI no tiene una API key configurada.")
        return OpenAIProvider(api_key, model, base_url)
    if provider_type == "anthropic":
        if not api_key:
            raise ProviderUnavailableError("El proveedor Claude no tiene una API key configurada.")
        return AnthropicProvider(api_key, model, base_url)
    raise ProviderUnavailableError(f"Tipo de proveedor '{provider_type}' desconocido.")
