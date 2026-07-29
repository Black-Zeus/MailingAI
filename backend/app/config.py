from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_name: str = "mailingai-backend"
    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "mailingai"
    db_user: str = "mailingai"
    db_password: str = "mailingai_password_change_me"

    n8n_webhook_internal_url: str = "http://n8n:5678/webhook/execute-analysis-job"
    n8n_webhook_download_url: str = "http://n8n:5678/webhook/download-attachment"
    n8n_webhook_retrace_url: str = "http://n8n:5678/webhook/retrace-attachments"
    n8n_webhook_send_email_url: str = "http://n8n:5678/webhook/send-case-email"
    webhook_shared_secret: str = ""
    webhook_shared_secret_header: str = "X-MailingAI-Secret"

    # identity-broker: dueño de las credenciales OAuth2 de los buzones
    # (ver migracion 20260723_0001). El backend solo hace de proxy hacia el
    # broker, nunca guarda tokens ni secretos el mismo.
    identity_broker_url: str = "http://identity-broker:8000"
    identity_broker_public_url: str = "http://localhost:8002"

    # Login de USUARIOS via SSO Microsoft/Entra ID (distinto del OAuth2 de
    # buzones de arriba: aca no se guarda ningun token de Microsoft a largo
    # plazo, solo se usa una vez para identificar quien es la persona). Mismo
    # app registration que identity-broker, con un segundo Redirect URI (ver
    # README.md, seccion "Seguridad y acceso multiusuario").
    ms_tenant_id: str = ""
    ms_client_id: str = ""
    ms_client_secret: str = ""
    ms_login_scope: str = "openid profile email User.Read"

    # URL publica (alcanzable desde el navegador) de este backend, usada como
    # redirect_uri del login SSO. URL publica del frontend, adonde se
    # redirige tras completar (o fallar) el login.
    backend_public_url: str = "http://localhost:8001"
    frontend_url: str = "http://localhost:5173"

    # Cookie de sesion (server-side, token opaco -- ver app/auth/sessions.py).
    # httponly va siempre hardcodeado en set_cookie, no es configurable.
    session_cookie_name: str = "mailingai_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"
    session_ttl_seconds: int = 43200
    session_absolute_ttl_seconds: int = 604800

    # La configuracion de proveedores de IA (Ollama/OpenAI/Anthropic) y la
    # politica ya no viven en variables de entorno -- se administran desde
    # Configuracion y quedan en mailing.ai_providers / mailing.ai_settings
    # (ver migracion 20260718_0002).


@lru_cache
def get_settings() -> Settings:
    return Settings()
