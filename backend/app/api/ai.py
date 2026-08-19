from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import AdminUserDep, CurrentUserDep
from app.db import get_pool
from app.schemas.ai import (
    AIAnalyzeResponse,
    AIBatchRunRead,
    AIHealthResponse,
    AskCaseQuestionRequest,
    AskCaseQuestionResponse,
    SummarizeTextRequest,
    SummarizeTextResponse,
)
from app.schemas.ai_providers import (
    AIPolicyRead,
    AIPolicyUpdate,
    AIProviderCreate,
    AIProviderModelsRequest,
    AIProviderModelsResponse,
    AIProviderRead,
    AIProviderRoleRequest,
    AIProviderTestResponse,
    AIProviderUpdate,
)
from app.services import ai_batch_service, ai_providers_service
from app.services.ai import gateway
from app.services.ai.base import ProviderUnavailableError

router = APIRouter(prefix="/api/ai", tags=["ai"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("/health", response_model=AIHealthResponse)
async def ai_health(pool: PoolDep) -> AIHealthResponse:
    return await gateway.health(pool)


@router.post("/cases/{case_id}/analyze", response_model=AIAnalyzeResponse)
async def analyze_case(
    case_id: int, pool: PoolDep, user: CurrentUserDep, background_tasks: BackgroundTasks
) -> AIAnalyzeResponse:
    """Responde al toque: si hay que llamar de verdad al proveedor de IA
    (la parte lenta), esa llamada se programa como BackgroundTask y el
    endpoint devuelve status='running' -- ver gateway.start_case_analysis."""
    try:
        result, finish = await gateway.start_case_analysis(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    except gateway.CaseAccessDeniedError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    if finish is not None:
        background_tasks.add_task(finish)
    return result


@router.post("/cases/{case_id}/ask", response_model=AskCaseQuestionResponse)
async def ask_case_question(
    case_id: int, payload: AskCaseQuestionRequest, pool: PoolDep, user: CurrentUserDep
) -> AskCaseQuestionResponse:
    """Pregunta-respuesta de una sola vuelta sobre los correos de un
    expediente (solo lectura, sin historial -- cada pregunta es
    independiente, ver gateway.ask_case_question)."""
    try:
        result = await gateway.ask_case_question(
            pool, case_id, payload.question, user_id=user.user_id, is_admin=user.is_admin
        )
    except gateway.AIQuestionBlockedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return result


@router.post("/summarize-text", response_model=SummarizeTextResponse)
async def summarize_text(payload: SummarizeTextRequest, pool: PoolDep, _user: CurrentUserDep) -> SummarizeTextResponse:
    """Condensa texto libre (ej. una glosa de cierre larga) al formato fijo
    de gateway._SUMMARIZE_SYSTEM_PROMPT -- de solo texto, no depende de
    ningun caso puntual, el frontend decide si acepta/descarta/reintenta."""
    try:
        return await gateway.summarize_text(pool, payload.text)
    except gateway.AIQuestionBlockedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/batch-analyze", response_model=AIBatchRunRead, status_code=http_status.HTTP_201_CREATED)
async def start_batch_analyze(pool: PoolDep, admin: AdminUserDep, background_tasks: BackgroundTasks) -> AIBatchRunRead:
    """Admin-only: list_pending_case_ids trae expedientes de todo el sistema,
    sin filtrar por dueño -- no es una operacion que corresponda disparar a
    un usuario comun sobre expedientes ajenos."""
    batch = await ai_batch_service.start_batch(pool)
    background_tasks.add_task(ai_batch_service.run_batch, pool, batch.batch_run_id, admin.user_id)
    return batch


@router.get("/batch-analyze/latest", response_model=AIBatchRunRead | None)
async def get_latest_batch_analyze(pool: PoolDep) -> AIBatchRunRead | None:
    return await ai_batch_service.get_latest_batch(pool)


@router.get("/batch-analyze/{batch_run_id}", response_model=AIBatchRunRead)
async def get_batch_analyze(batch_run_id: UUID, pool: PoolDep) -> AIBatchRunRead:
    batch = await ai_batch_service.get_batch(pool, batch_run_id)
    if batch is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Corrida en lote no encontrada")
    return batch


@router.get("/providers", response_model=list[AIProviderRead])
async def list_providers(pool: PoolDep, _admin: AdminUserDep) -> list[AIProviderRead]:
    return await ai_providers_service.list_providers(pool)


@router.post("/providers", response_model=AIProviderRead, status_code=http_status.HTTP_201_CREATED)
async def create_provider(payload: AIProviderCreate, pool: PoolDep, _admin: AdminUserDep) -> AIProviderRead:
    try:
        return await ai_providers_service.create_provider(pool, payload)
    except ai_providers_service.InvalidProviderConfigError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/providers/models", response_model=AIProviderModelsResponse)
async def list_provider_models(
    payload: AIProviderModelsRequest, pool: PoolDep, _admin: AdminUserDep
) -> AIProviderModelsResponse:
    try:
        models = await ai_providers_service.list_available_models(
            pool,
            provider_type=payload.provider_type,
            base_url=payload.base_url,
            api_key=payload.api_key,
            provider_id=payload.provider_id,
        )
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return AIProviderModelsResponse(models=models)


@router.post("/providers/embedding-models", response_model=AIProviderModelsResponse)
async def list_provider_embedding_models(
    payload: AIProviderModelsRequest, _admin: AdminUserDep
) -> AIProviderModelsResponse:
    """Como /providers/models, pero filtrado a los modelos que Ollama marca
    con capability 'embedding' -- siempre contra el base_url recibido, sin
    importar provider_type/api_key (el rol de embeddings solo existe para
    Ollama)."""
    try:
        models = await ai_providers_service.list_available_embedding_models(payload.base_url)
    except ai_providers_service.InvalidProviderConfigError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return AIProviderModelsResponse(models=models)


@router.put("/providers/{provider_id}", response_model=AIProviderRead)
async def update_provider(
    provider_id: int, payload: AIProviderUpdate, pool: PoolDep, _admin: AdminUserDep
) -> AIProviderRead:
    try:
        provider = await ai_providers_service.update_provider(pool, provider_id, payload)
    except ai_providers_service.InvalidProviderConfigError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if provider is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado")
    return provider


@router.delete("/providers/{provider_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_provider(provider_id: int, pool: PoolDep, _admin: AdminUserDep) -> None:
    deleted = await ai_providers_service.delete_provider(pool, provider_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado")


@router.post("/providers/{provider_id}/test", response_model=AIProviderTestResponse)
async def test_provider(provider_id: int, pool: PoolDep, _admin: AdminUserDep) -> AIProviderTestResponse:
    """Prueba este proveedor puntual (este activo o no) -- a diferencia de
    /api/ai/health, que solo prueba el que esta activo."""
    healthy = await ai_providers_service.test_provider(pool, provider_id)
    if healthy is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado")
    return AIProviderTestResponse(healthy=healthy)


@router.post("/providers/{provider_id}/activate", response_model=AIProviderRead)
async def activate_provider_role(
    provider_id: int, payload: AIProviderRoleRequest, pool: PoolDep, _admin: AdminUserDep
) -> AIProviderRead:
    """Prende un rol (chat/embeddings) en este proveedor -- lo apaga en
    cualquier otro que lo tuviera. El otro rol de este mismo proveedor (si lo
    tiene) no se toca, asi que un proveedor puede terminar sirviendo los dos
    roles a la vez."""
    try:
        provider = await ai_providers_service.activate_role(pool, provider_id, payload.role)
    except ai_providers_service.PolicyBlocksProviderError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ai_providers_service.InvalidProviderConfigError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if provider is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado")
    return provider


@router.post("/providers/{provider_id}/deactivate", response_model=AIProviderRead)
async def deactivate_provider_role(
    provider_id: int, payload: AIProviderRoleRequest, pool: PoolDep, _admin: AdminUserDep
) -> AIProviderRead:
    """Apaga un rol en este proveedor sin activarlo en ningun otro -- deja
    ese rol sin proveedor asignado hasta que alguien active uno."""
    provider = await ai_providers_service.deactivate_role(pool, provider_id, payload.role)
    if provider is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado")
    return provider


@router.get("/policy", response_model=AIPolicyRead)
async def get_policy(pool: PoolDep, _admin: AdminUserDep) -> AIPolicyRead:
    return AIPolicyRead(policy=await ai_providers_service.get_policy(pool))


@router.put("/policy", response_model=AIPolicyRead)
async def update_policy(payload: AIPolicyUpdate, pool: PoolDep, _admin: AdminUserDep) -> AIPolicyRead:
    return AIPolicyRead(policy=await ai_providers_service.set_policy(pool, payload.policy))
