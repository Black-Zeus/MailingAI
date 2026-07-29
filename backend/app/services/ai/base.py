from abc import ABC, abstractmethod
from typing import Any


class ProviderUnavailableError(Exception):
    pass


class AIProvider(ABC):
    """Interfaz que debe implementar cualquier proveedor de IA (Ollama, LM Studio, OpenAI, Claude, ...).

    La logica de negocio (AIGateway) nunca debe depender de un proveedor
    concreto -- solo de esta interfaz. master.md seccion 11.
    """

    name: str
    model: str

    @abstractmethod
    async def analyze(self, system_prompt: str, user_content: str) -> str:
        """Devuelve la respuesta cruda del modelo (texto). El llamador valida/parsea."""

    @abstractmethod
    async def health_check(self) -> bool:
        """True si el proveedor esta disponible para recibir requests ahora mismo."""

    @abstractmethod
    async def list_models(self) -> list[str]:
        """Modelos disponibles en este proveedor."""

    @abstractmethod
    def supports_structured_output(self) -> bool:
        """True si el proveedor puede forzar/garantizar salida JSON valida nativamente."""
