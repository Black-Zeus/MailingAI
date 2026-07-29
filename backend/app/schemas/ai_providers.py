from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AIProviderType = Literal["ollama", "openai", "anthropic"]
AIPolicy = Literal["local_only", "allow_external"]


class AIProviderCreate(BaseModel):
    label: str = Field(min_length=1)
    provider_type: AIProviderType
    base_url: str | None = None
    model: str = Field(min_length=1)
    api_key: str | None = None


class AIProviderUpdate(BaseModel):
    label: str = Field(min_length=1)
    provider_type: AIProviderType
    base_url: str | None = None
    model: str = Field(min_length=1)
    api_key: str | None = None  # None = mantener la key ya guardada sin cambios


class AIProviderRead(BaseModel):
    provider_id: int
    label: str
    provider_type: AIProviderType
    base_url: str | None
    model: str
    has_api_key: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


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
