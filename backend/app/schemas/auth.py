from typing import Literal

from pydantic import BaseModel, Field

UserRole = Literal["admin", "user"]


class CurrentUserRead(BaseModel):
    user_id: int
    email_address: str
    display_name: str | None
    role: UserRole
    must_change_password: bool = False


class LocalLoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)
