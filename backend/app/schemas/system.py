from pydantic import BaseModel


class SystemStatus(BaseModel):
    backend: bool
    postgres: bool
    n8n: bool
    ai: bool


class StatsResponse(BaseModel):
    message_count: int
    attachment_count: int
    conversation_count: int
    case_count: int
