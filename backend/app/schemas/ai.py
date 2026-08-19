from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.ai_providers import AIProviderRead
from app.schemas.case_enums import CaseOutcome

RunStatus = Literal["running", "success", "failed", "blocked_by_policy"]


class AICaseSummary(BaseModel):
    summary: str
    key_participants: list[str] = []
    suggested_priority: Literal["low", "medium", "high"] = "medium"
    suggested_next_action: str = ""
    # Default "pendiente" -- no rompe si un modelo chico omite el campo
    # (prompt_version anteriores a case-summary-v6 tampoco lo pedian).
    suggested_outcome: CaseOutcome = "pendiente"

    @field_validator("key_participants", mode="before")
    @classmethod
    def _coerce_participants_to_strings(cls, value: Any) -> Any:
        # Modelos chicos a veces devuelven objetos ({"name": ..., "email": ...})
        # en vez de strings planos -- se tolera y se convierte, no se rechaza
        # el resultado entero por eso.
        if not isinstance(value, list):
            return value
        coerced = []
        for item in value:
            if isinstance(item, str):
                coerced.append(item)
            elif isinstance(item, dict):
                coerced.append(
                    item.get("email") or item.get("name") or item.get("address") or str(item)
                )
            else:
                coerced.append(str(item))
        return coerced


class AIAnalyzeRequest(BaseModel):
    case_id: int


class AIAnalyzeResponse(BaseModel):
    ai_run_id: int
    status: RunStatus
    provider: str
    model: str
    policy: str
    result: AICaseSummary | None = None
    error_message: str | None = None
    analyzed_at: datetime | None = None


class AskCaseQuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class AskCaseQuestionResponse(BaseModel):
    answer: str
    provider: str
    model: str
    # True si el expediente no entraba completo en num_ctx y la respuesta se
    # armo con los fragmentos mas relevantes por busqueda semantica en vez
    # del contenido completo -- el frontend lo usa para avisarle al auditor
    # que conviene revisar el expediente completo a mano si la respuesta no
    # alcanza (a diferencia del contexto completo, un fallo de recall aca es
    # invisible: el modelo nunca vio lo que no se recupero).
    used_retrieval: bool = False


class SummarizeTextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


class SummarizeTextResponse(BaseModel):
    summary: str
    provider: str
    model: str


class AIHealthResponse(BaseModel):
    policy: str
    active_provider: AIProviderRead | None
    healthy: bool | None = None


BatchRunStatus = Literal["queued", "running", "success", "failed"]


class AIBatchRunRead(BaseModel):
    batch_run_id: UUID
    status: BatchRunStatus
    total_cases: int
    processed_cases: int
    succeeded_cases: int
    failed_cases: int
    error_message: str | None
    requested_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
