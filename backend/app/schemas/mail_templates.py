from datetime import datetime

from pydantic import BaseModel, Field


class MailTemplateCreate(BaseModel):
    name: str = Field(min_length=1)
    subject_template: str = Field(min_length=1)
    body_template: str = Field(min_length=1)


class MailTemplateUpdate(BaseModel):
    name: str | None = None
    subject_template: str | None = None
    body_template: str | None = None
    active: bool | None = None


class MailTemplateRead(BaseModel):
    template_id: int
    name: str
    subject_template: str
    body_template: str
    active: bool
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime


class MailTemplateRenderRequest(BaseModel):
    manual_values: dict[str, str] = {}


class MailTemplateRenderResponse(BaseModel):
    subject: str
    body: str
