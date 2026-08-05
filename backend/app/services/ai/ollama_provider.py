import httpx

from app.services.ai.base import AIProvider, ProviderUnavailableError


# Ollama usa 2048 tokens de contexto por defecto si no se especifica num_ctx,
# sin importar cuanto contexto soporte el modelo -- muy por debajo de lo que
# necesita ask_case_question, que manda el cuerpo COMPLETO de todos los
# correos de un expediente en un solo prompt. Sin esto, expedientes con
# varios correos largos se truncan en silencio (Ollama no avisa, el modelo
# simplemente no ve el contenido que quedo afuera).
#
# El valor real es configurable por proveedor desde Configuracion >
# Integracion IA (columna num_ctx en mailing.ai_providers, ver migracion
# 20260804_0001) -- este es solo el fallback para llamadas que arman un
# proveedor Ollama "ad-hoc" sin pasar por la tabla (ej. list_available_models
# antes de guardar un proveedor nuevo). 8192 y no el maximo del modelo:
# el KV cache escala con num_ctx, y en hardware compartido (ej. un Mac mini de
# 16GB corriendo tambien Colima) un num_ctx alto puede generar swap pesado y
# vueltas de varios minutos por pregunta -- ver nota en la migracion.
_DEFAULT_NUM_CTX = 8192


class OllamaProvider(AIProvider):
    name = "ollama"

    def __init__(self, base_url: str, model: str, num_ctx: int | None = None):
        self._base_url = base_url.rstrip("/")
        self._model = model
        self.model = model
        self._num_ctx = num_ctx or _DEFAULT_NUM_CTX

    async def analyze(self, system_prompt: str, user_content: str, *, json_mode: bool = True) -> str:
        payload = {
            "model": self._model,
            "system": system_prompt,
            "prompt": user_content,
            "stream": False,
            # Temperatura baja a proposito: esto es analisis factual (citar lo
            # que ya esta en el contenido), no generacion creativa -- una
            # temperatura alta hacia que la calidad del resumen variara mucho
            # entre corridas identicas (a veces citaba evidencia tecnica
            # concreta, a veces la diluia en una frase vaga).
            "options": {"temperature": 0.2, "num_ctx": self._num_ctx},
        }
        if json_mode:
            payload["format"] = "json"
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
