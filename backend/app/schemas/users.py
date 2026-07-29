from datetime import datetime

from pydantic import BaseModel

from app.schemas.auth import UserRole


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


class UserCreate(BaseModel):
    email_address: str
    display_name: str | None = None
    role: UserRole = "user"


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
