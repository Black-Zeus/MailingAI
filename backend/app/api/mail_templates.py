from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.schemas.mail_templates import (
    MailTemplateCreate,
    MailTemplateRead,
    MailTemplateRenderRequest,
    MailTemplateRenderResponse,
    MailTemplateUpdate,
)
from app.services import mail_templates_service

router = APIRouter(prefix="/api", tags=["mail-templates"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("/mail-templates", response_model=list[MailTemplateRead])
async def list_mail_templates(
    pool: PoolDep, _user: CurrentUserDep, active_only: bool = Query(default=False)
) -> list[MailTemplateRead]:
    """Recurso de equipo: cualquier usuario autenticado ve todas las
    plantillas, no solo las propias -- ver mail_templates_service."""
    return await mail_templates_service.list_templates(pool, active_only=active_only)


@router.post("/mail-templates", response_model=MailTemplateRead, status_code=http_status.HTTP_201_CREATED)
async def create_mail_template(payload: MailTemplateCreate, pool: PoolDep, user: CurrentUserDep) -> MailTemplateRead:
    return await mail_templates_service.create_template(
        pool,
        name=payload.name,
        subject_template=payload.subject_template,
        body_template=payload.body_template,
        user=user,
    )


@router.patch("/mail-templates/{template_id}", response_model=MailTemplateRead)
async def update_mail_template(
    template_id: int, payload: MailTemplateUpdate, pool: PoolDep, _user: CurrentUserDep
) -> MailTemplateRead:
    template = await mail_templates_service.update_template(
        pool, template_id, fields=payload.model_dump(exclude_unset=True)
    )
    if template is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Plantilla no encontrada")
    return template


@router.delete("/mail-templates/{template_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_mail_template(template_id: int, pool: PoolDep, _user: CurrentUserDep) -> None:
    deleted = await mail_templates_service.delete_template(pool, template_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Plantilla no encontrada")


@router.post("/cases/{case_id}/mail-templates/{template_id}/render", response_model=MailTemplateRenderResponse)
async def render_mail_template(
    case_id: int, template_id: int, payload: MailTemplateRenderRequest, pool: PoolDep, user: CurrentUserDep
) -> MailTemplateRenderResponse:
    try:
        result = await mail_templates_service.render_report(
            pool, case_id, template_id, manual_values=payload.manual_values, user=user
        )
    except mail_templates_service.ReportRequiresClosedCaseError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso o plantilla no encontrados")
    subject, body = result
    return MailTemplateRenderResponse(subject=subject, body=body)
