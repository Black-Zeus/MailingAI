from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi import status as http_status
from fastapi.responses import Response

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.repositories import access_repository
from app.schemas.jobs import JobCreate, JobCreatedResponse, JobRead
from app.schemas.messages import MessageListItem
from app.services import jobs_service, messages_service

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

DeleteJobsScope = Literal["failed", "finished", "all-inactive"]


@router.post("", response_model=JobCreatedResponse, status_code=http_status.HTTP_202_ACCEPTED)
async def create_job(
    payload: JobCreate, pool: PoolDep, background_tasks: BackgroundTasks, user: CurrentUserDep
) -> JobCreatedResponse:
    result = await jobs_service.create_job(
        pool, payload.job_type, payload.parameters, created_by_user_id=user.user_id
    )
    background_tasks.add_task(
        jobs_service.trigger_job,
        pool,
        result.job_id,
        payload.job_type,
        payload.parameters,
    )
    return result


@router.get("", response_model=list[JobRead])
async def list_jobs(
    pool: PoolDep,
    user: CurrentUserDep,
    limit: int = Query(default=50, ge=1, le=200),
    job_status: str | None = Query(default=None, alias="status"),
) -> list[JobRead]:
    return await jobs_service.list_jobs(
        pool, limit=limit, status=job_status, user_id=user.user_id, is_admin=user.is_admin
    )


@router.delete("", status_code=http_status.HTTP_200_OK)
async def delete_jobs(pool: PoolDep, user: CurrentUserDep, scope: DeleteJobsScope = Query(...)) -> dict[str, int]:
    deleted = await jobs_service.delete_jobs(pool, scope, user_id=user.user_id, is_admin=user.is_admin)
    return {"deleted": deleted}


@router.get("/{job_id}", response_model=JobRead)
async def get_job(job_id: UUID, pool: PoolDep, user: CurrentUserDep) -> JobRead:
    job = await jobs_service.get_job(pool, job_id, user_id=user.user_id, is_admin=user.is_admin)
    if job is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Job no encontrado")
    return job


@router.delete("/{job_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_job(job_id: UUID, pool: PoolDep, user: CurrentUserDep) -> None:
    try:
        deleted = await jobs_service.delete_job(pool, job_id, user_id=user.user_id, is_admin=user.is_admin)
    except jobs_service.JobNotDeletableError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Job no encontrado")


@router.post("/{job_id}/cancel", response_model=JobRead)
async def cancel_job(job_id: UUID, pool: PoolDep, user: CurrentUserDep) -> JobRead:
    try:
        job = await jobs_service.cancel_job(pool, job_id, user_id=user.user_id, is_admin=user.is_admin)
    except jobs_service.JobNotCancellableError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Job no encontrado")
    return job


@router.get("/{job_id}/messages", response_model=list[MessageListItem])
async def get_job_messages(job_id: UUID, pool: PoolDep, user: CurrentUserDep) -> list[MessageListItem]:
    job = await jobs_service.get_job(pool, job_id, user_id=user.user_id, is_admin=user.is_admin)
    if job is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Job no encontrado")
    if job.fetch_run_id is None:
        return []
    accessible_mailbox_ids = await access_repository.resolve_accessible_mailbox_ids(pool, user)
    return await messages_service.list_messages_by_run(
        pool, job.fetch_run_id, accessible_mailbox_ids=accessible_mailbox_ids
    )


@router.get("/{job_id}/chart")
async def get_job_chart(job_id: UUID, pool: PoolDep, user: CurrentUserDep) -> Response:
    job = await jobs_service.get_job(pool, job_id, user_id=user.user_id, is_admin=user.is_admin)
    if job is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Job no encontrado")
    if job.chart_id is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Este trabajo no tiene un gráfico vinculado.",
        )
    output_file = await jobs_service.get_chart_output_file(pool, job.chart_id)
    if not output_file or not Path(output_file).is_file():
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="El archivo del gráfico ya no está disponible en el servidor.",
        )
    return Response(content=Path(output_file).read_bytes(), media_type="image/png")


@router.post(
    "/{job_id}/retry", response_model=JobCreatedResponse, status_code=http_status.HTTP_202_ACCEPTED
)
async def retry_job(
    job_id: UUID, pool: PoolDep, background_tasks: BackgroundTasks, user: CurrentUserDep
) -> JobCreatedResponse:
    try:
        result = await jobs_service.retry_job(pool, job_id, user_id=user.user_id, is_admin=user.is_admin)
    except jobs_service.JobNotRetryableError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Job no encontrado")

    new_job = await jobs_service.get_job(pool, result.job_id, user_id=user.user_id, is_admin=user.is_admin)
    background_tasks.add_task(
        jobs_service.trigger_job,
        pool,
        new_job.job_id,
        new_job.job_type,
        new_job.parameters,
    )
    return result
