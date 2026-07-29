from typing import Literal

from pydantic import BaseModel

UserRole = Literal["admin", "user"]


class CurrentUserRead(BaseModel):
    user_id: int
    email_address: str
    display_name: str | None
    role: UserRole
