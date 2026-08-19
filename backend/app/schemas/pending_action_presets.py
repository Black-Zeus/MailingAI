from datetime import datetime

from pydantic import BaseModel, Field


class PendingActionPresetCreate(BaseModel):
    text: str = Field(min_length=1)


class PendingActionPresetRead(BaseModel):
    preset_id: int
    text: str
    created_by_user_id: int | None
    created_at: datetime
