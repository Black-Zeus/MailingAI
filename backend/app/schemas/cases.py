from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.ai import AIAnalyzeResponse
from app.schemas.case_enums import CaseOutcome

SeedType = Literal["conversation_id", "cr_keyword", "message_id"]
CaseType = Literal["conversation", "cr", "custom"]
DeterminationType = Literal["hecho_observado", "regla", "inferencia_ia", "validacion_manual"]
CaseStatus = Literal["open", "closed"]


class CaseCreate(BaseModel):
    title: str
    seed_type: SeedType
    seed_value: str = Field(min_length=1)
    case_type: CaseType = "custom"


class CaseAddMessage(BaseModel):
    message_id: str = Field(min_length=1)


class CaseMessageSearchRequest(BaseModel):
    query: str = Field(min_length=1)


class CaseBulkRemoveMessages(BaseModel):
    message_ids: list[str] = Field(min_length=1)
    query: str | None = None


class ExclusionRuleCreate(BaseModel):
    pattern: str = Field(min_length=1)
    match_subject: bool = False
    match_body: bool = False
    match_from: bool = False
    match_to: bool = False
    match_cc: bool = False
    match_attachment: bool = False


class ExclusionRuleUpdate(BaseModel):
    pattern: str | None = None
    match_subject: bool | None = None
    match_body: bool | None = None
    match_from: bool | None = None
    match_to: bool | None = None
    match_cc: bool | None = None
    match_attachment: bool | None = None
    enabled: bool | None = None


class ExclusionRuleRead(BaseModel):
    rule_id: int
    owner_user_id: int
    case_id: int | None
    pattern: str
    match_subject: bool
    match_body: bool
    match_from: bool
    match_to: bool
    match_cc: bool
    match_attachment: bool
    enabled: bool
    created_at: datetime
    updated_at: datetime


class CaseMergeRequest(BaseModel):
    case_ids: list[int] = Field(min_length=2)
    title: str = Field(min_length=1)


class CaseAttachmentRead(BaseModel):
    attachment_row_id: int
    attachment_id: str
    file_name: str
    extension: str | None
    size_bytes: int | None
    matches_naming_convention: bool
    matches_search_pattern: bool | None
    content_sha256: str | None = None


class CaseMessageRead(BaseModel):
    message_id: str
    subject: str | None
    from_address: str | None
    to_addresses: list[str] = []
    cc_addresses: list[str] = []
    sent_datetime: datetime | None
    relationship_type: str
    confidence: float
    correlation_source: str
    has_attachments: bool
    attachments: list[CaseAttachmentRead]
    body_preview: str | None
    body_content: str | None
    body_content_type: str
    web_link: str | None
    mailbox_account_id: int | None
    mailbox_label: str | None


class TimelineEventRead(BaseModel):
    event_id: int
    occurred_at: datetime | None
    actor: str | None
    action_type: str
    description: str | None
    source_message_id: str | None
    source_attachment_id: int | None
    determination_type: DeterminationType
    confidence: float | None


class CaseNoteRead(BaseModel):
    note_id: int
    body: str
    body_markdown: str
    created_at: datetime
    created_by_user_id: int | None = None
    created_by_label: str | None = None
    updated_at: datetime | None = None


class CaseNoteCreate(BaseModel):
    body: str = Field(min_length=1)


class CaseNoteUpdate(BaseModel):
    body: str = Field(min_length=1)


class CaseEvidenceRead(BaseModel):
    evidence_id: int
    glosa: str
    file_name: str
    content_type: str
    size_bytes: int
    created_at: datetime


class CaseSentEmailRead(BaseModel):
    sent_email_id: int
    to_addresses: list[str]
    cc_addresses: list[str]
    subject: str
    body_html: str
    attached_case_pdf: bool
    attachment_names: list[str]
    sent_at: datetime
    sent_by_label: str | None


class CaseSummary(BaseModel):
    case_id: int
    case_type: str
    external_code: str | None
    title: str
    status: str
    confidence: float | None
    message_count: int
    first_message_at: datetime | None
    last_message_at: datetime | None
    outcome: CaseOutcome | None = None
    has_successful_ai_run: bool = False
    ai_stale: bool = False
    has_own_reply: bool = False
    owner_user_id: int | None = None
    created_at: datetime
    pending_action: str | None = None
    next_review_at: date | None = None
    previous_owner_label: str | None = None
    updated_at: datetime
    pending_reopen_message_count: int = 0
    closing_glosa: str | None = None
    alert_type: str | None = None


class CaseDetail(CaseSummary):
    messages: list[CaseMessageRead]
    timeline: list[TimelineEventRead]
    notes: list[CaseNoteRead] = []
    evidence: list[CaseEvidenceRead] = []
    sent_emails: list[CaseSentEmailRead] = []
    latest_ai_run: AIAnalyzeResponse | None = None
    ai_summary_override: str | None = None


class CaseAiSummaryUpdate(BaseModel):
    summary: str = Field(min_length=1)
    expected_updated_at: datetime | None = None


class CaseDashboardStats(BaseModel):
    total: int
    open_count: int
    closed_count: int
    overdue_review_count: int
    stale_ai_count: int
    no_ai_count: int
    by_outcome: dict[str, int]


class CaseAuditLogRead(BaseModel):
    audit_id: int
    user_display_name: str | None
    occurred_at: datetime
    field_name: str | None
    old_value: str | None
    new_value: str | None
    description: str


class CaseRefreshResponse(BaseModel):
    case: CaseDetail
    new_messages_found: int


class CaseSendEmailResponse(BaseModel):
    sent: bool


class CaseBulkRefreshResponse(BaseModel):
    cases_checked: int
    cases_with_new_messages: int
    new_messages_found: int
    errors: int
    closed_cases_flagged: int = 0


class TimelineEventUpdate(BaseModel):
    determination_type: DeterminationType


class CaseOwnerReassignRequest(BaseModel):
    new_owner_user_id: int


class CaseUpdate(BaseModel):
    outcome: CaseOutcome | None = None
    status: CaseStatus | None = None
    pending_action: str | None = None
    next_review_at: date | None = None
    closing_glosa: str | None = None
    alert_type: str | None = None
    expected_updated_at: datetime | None = None


CaseSharePermission = Literal["read", "edit"]


class CaseShareRead(BaseModel):
    user_id: int
    email_address: str
    display_name: str | None
    permission: CaseSharePermission
    created_at: datetime


class CaseShareCreate(BaseModel):
    user_id: int
    permission: CaseSharePermission = "read"


CaseBatchItemStatus = Literal["pendiente", "creando", "listo", "error"]
CaseBatchStatus = Literal["queued", "running", "success", "failed"]


class CaseBatchCreate(BaseModel):
    keywords: list[str] = Field(min_length=1)
    case_type: CaseType = "cr"
    search_mailbox: bool = False
    mailbox_account_id: int | None = None
    date_from: date | None = None
    date_to: date | None = None


class CaseBatchItemRead(BaseModel):
    item_id: int
    position: int
    keyword: str
    status: CaseBatchItemStatus
    detail: str | None
    case_id: int | None
    reused: bool = False


class CaseBatchRunRead(BaseModel):
    batch_run_id: UUID
    status: CaseBatchStatus
    case_type: CaseType
    total_keywords: int
    processed_keywords: int
    error_message: str | None
    requested_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    search_mailbox: bool
    mailbox_account_id: int | None
    date_from: date | None
    date_to: date | None
    created_count: int
    correlated_count: int
    searched_count: int
    items: list[CaseBatchItemRead] = []
