import httpx

from app.services.ai.base import AIProvider, ProviderUnavailableError


class OllamaProvider(AIProvider):
    name = "ollama"

    def __init__(self, base_url: str, model: str):
        self._base_url = base_url.rstrip("/")
        self._model = model
        self.model = model

    async def analyze(self, system_prompt: str, user_content: str) -> str:
        payload = {
            "model": self._model,
            "system": system_prompt,
            "prompt": user_content,
            "stream": False,
            "format": "json",
            # Temperatura baja a proposito: esto es analisis factual (citar lo
            # que ya esta en el contenido), no generacion creativa -- una
            # temperatura alta hacia que la calidad del resumen variara mucho
            # entre corridas identicas (a veces citaba evidencia tecnica
            # concreta, a veces la diluia en una frase vaga).
            "options": {"temperature": 0.2},
        }
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(f"{self._base_url}/api/generate", json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderUnavailableError(f"Ollama no respondio ({type(exc).__name__}): {exc}") from exc
        data = response.json()
        return data.get("response", "")

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self._base_url}/api/tags")
                return response.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self._base_url}/api/tags")
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderUnavailableError(f"Ollama no respondio ({type(exc).__name__}): {exc}") from exc
        data = response.json()
        return [m["name"] for m in data.get("models", [])]

    def supports_structured_output(self) -> bool:
        return True
