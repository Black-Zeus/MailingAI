from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.auth import UserRole

AuthMethod = Literal["sso", "local"]


class UserRead(BaseModel):
    user_id: int
    ms_object_id: str | None
    email_address: str
    display_name: str | None
    role: UserRole
    enabled: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None
    auth_method: AuthMethod
    username: str | None
    must_change_password: bool


class UserCreate(BaseModel):
    email_address: str
    display_name: str | None = None
    role: UserRole = "user"
    auth_method: AuthMethod = "sso"
    username: str | None = Field(default=None, min_length=3)
    password: str | None = Field(default=None, min_length=8)

    @model_validator(mode="after")
    def _validate_local_fields(self) -> "UserCreate":
        if self.auth_method == "local" and (not self.username or not self.password):
            raise ValueError("Una cuenta local necesita usuario y contraseña.")
        return self


class UserPasswordReset(BaseModel):
    new_password: str = Field(min_length=8)


class UserDeletionImpactRead(BaseModel):
    cases_owned: int


class UserDeleteResponse(BaseModel):
    cases_reassigned: int


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: UserRole | None = None
    enabled: bool | None = None


class UserDirectoryEntry(BaseModel):
    """Version minima de UserRead -- sin role/ms_object_id/last_login -- para
    el picker de "compartir con", accesible a cualquier usuario logueado."""

    user_id: int
    email_address: str
    display_name: str | None


class UserMailboxAccessEntry(BaseModel):
    """Un buzon al que un usuario tiene acceso, visto desde su ficha en el
    panel de administracion."""

    mailbox_account_id: int
    label: str
    email_address: str | None
    enabled: bool
    relation: str  # 'owner' | 'read'
