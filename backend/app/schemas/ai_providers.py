from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AIProviderType = Literal["ollama", "openai", "anthropic"]
AIPolicy = Literal["local_only", "allow_external"]
# "chat" = usado para preguntas/analisis de expedientes, "embeddings" = usado
# para busqueda semantica de expedientes grandes. Un mismo proveedor puede
# tener los dos roles a la vez -- no existe un "activar" generico, cada rol
# se prende/apaga por separado (ver ai_providers_service.activate_role).
AIProviderRole = Literal["chat", "embeddings"]

# Lista cerrada (no un rango libre) para que la UI la muestre como select y
# evitar que alguien meta un numero arbitrario que Ollama rechace o que
# dispare el mismo problema de memoria que motivo este campo (ver migracion
# 20260804_0001 y ollama_provider.py).
NumCtxOption = Literal[2048, 4096, 8192, 16384, 32768, 65536]
_DEFAULT_NUM_CTX: NumCtxOption = 8192
_DEFAULT_EMBEDDINGS_MODEL = "bge-m3"


class AIProviderCreate(BaseModel):
    label: str = Field(min_length=1)
    provider_type: AIProviderType
    base_url: str | None = None
    model: str = Field(min_length=1)
    num_ctx: NumCtxOption = _DEFAULT_NUM_CTX
    # Independiente de "model" (que es el modelo de chat) -- solo se usa si
    # este proveedor termina con el rol de embeddings activo, pero se guarda
    # siempre para que quede listo apenas se active ese rol.
    embeddings_model: str = Field(default=_DEFAULT_EMBEDDINGS_MODEL, min_length=1)
    api_key: str | None = None


class AIProviderUpdate(BaseModel):
    label: str = Field(min_length=1)
    provider_type: AIProviderType
    base_url: str | None = None
    model: str = Field(min_length=1)
    num_ctx: NumCtxOption = _DEFAULT_NUM_CTX
    embeddings_model: str = Field(default=_DEFAULT_EMBEDDINGS_MODEL, min_length=1)
    api_key: str | None = None  # None = mantener la key ya guardada sin cambios


class AIProviderRead(BaseModel):
    provider_id: int
    label: str
    provider_type: AIProviderType
    base_url: str | None
    model: str
    num_ctx: int
    embeddings_model: str
    has_api_key: bool
    is_chat_active: bool
    is_embeddings_active: bool
    created_at: datetime
    updated_at: datetime


class AIProviderRoleRequest(BaseModel):
    role: AIProviderRole


class AIPolicyRead(BaseModel):
    policy: AIPolicy


class AIPolicyUpdate(BaseModel):
    policy: AIPolicy


class AIProviderModelsRequest(BaseModel):
    provider_type: AIProviderType
    base_url: str | None = None
    api_key: str | None = None
    provider_id: int | None = None  # si se edita un proveedor existente y no se retipeo la key


class AIProviderModelsResponse(BaseModel):
    models: list[str]


class AIProviderTestResponse(BaseModel):
    healthy: bool
