from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

JobType = Literal[
    "fetch_sent_items",
    "fetch_message_series",
    "fetch_related_thread",
    "fetch_cr_attachments",
    "generate_activity_charts",
    "discover_mail_folders",
    "search_attachments",
]

JobStatus = Literal["queued", "running", "success", "failed", "cancelled"]


class JobCreate(BaseModel):
    job_type: JobType
    parameters: dict[str, Any] = Field(default_factory=dict)


class JobCreatedResponse(BaseModel):
    job_id: UUID
    status: JobStatus
    created_at: datetime


class JobRead(BaseModel):
    job_id: UUID
    job_type: str
    status: JobStatus
    current_stage: str | None
    parameters: dict[str, Any]
    processed_items: int
    total_items: int | None
    progress_percentage: float | None
    result_count: int | None
    requested_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_code: str | None
    error_message: str | None
    retry_count: int
    retry_of_job_id: UUID | None
    fetch_run_id: int | None
    chart_id: int | None
    created_by_user_id: int | None
