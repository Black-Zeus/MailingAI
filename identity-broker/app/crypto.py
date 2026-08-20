"""Cifrado at-rest de access_token/refresh_token de Graph (identity.mailbox_accounts).

Antes se guardaban en texto plano -- un dump puntual de esa tabla alcanzaba
para leer y enviar correo (scope Mail.Send) como cualquier buzon conectado.
Fernet (AES-128-CBC + HMAC autenticado) con una clave fuera de la base,
mismo criterio que ya se aplica a las sesiones (se guarda el hash, no el
token crudo)."""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


@lru_cache
def _fernet() -> Fernet:
    settings = get_settings()
    return Fernet(settings.mailbox_token_encryption_key.encode("utf-8"))


def encrypt_token(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_token(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError(
            "No se pudo descifrar un token de buzon -- clave MAILBOX_TOKEN_ENCRYPTION_KEY "
            "incorrecta o el valor no fue cifrado con esta clave."
        ) from exc
