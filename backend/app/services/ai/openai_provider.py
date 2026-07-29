import httpx

from app.services.ai.base import AIProvider, ProviderUnavailableError

_DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAIProvider(AIProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        self._api_key = api_key
        self._base_url = (base_url or _DEFAULT_BASE_URL).rstrip("/")
        self.model = model

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def analyze(self, system_prompt: str, user_content: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "response_format": {"type": "json_object"},
            # Analisis factual (citar lo que ya esta en el contenido), no
            # generacion creativa -- temperatura baja para resultados
            # consistentes entre corridas identicas.
            "temperature": 0.2,
        }
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{self._base_url}/chat/completions", json=payload, headers=self._headers()
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderUnavailableError(f"OpenAI no respondio ({type(exc).__name__}): {exc}") from exc
        data = response.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderUnavailableError(f"OpenAI devolvio una respuesta con forma inesperada: {exc}") from exc

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self._base_url}/models", headers=self._headers())
                return response.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self._base_url}/models", headers=self._headers())
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderUnavailableError(f"OpenAI no respondio ({type(exc).__name__}): {exc}") from exc
        data = response.json()
        return [m["id"] for m in data.get("data", [])]

    def supports_structured_output(self) -> bool:
        return True
