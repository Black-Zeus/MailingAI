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

    # La configuracion de proveedores de IA (Ollama/OpenAI/Anthropic) y la
    # politica ya no viven en variables de entorno -- se administran desde
    # Configuracion y quedan en mailing.ai_providers / mailing.ai_settings
    # (ver migracion 20260718_0002).


@lru_cache
def get_settings() -> Settings:
    return Settings()
