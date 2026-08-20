from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_name: str = "mailingai-identity-broker"
    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "mailingai"
    db_user: str = "mailingai"
    db_password: str = "mailingai_password_change_me"

    # Mismo app registration de Azure AD que ya usaba la credencial nativa de
    # n8n (ver n8n/credentials/mailingai-graph-oauth2.json) -- agregar un
    # buzon nuevo es repetir el consentimiento delegado con esta misma app,
    # no crear una app distinta.
    ms_tenant_id: str = ""
    ms_client_id: str = ""
    ms_client_secret: str = ""
    # Nombre para mostrar del tenant sembrado a partir de estas variables
    # (identity.tenant_configs) -- si queda vacio, el tenant se siembra con
    # label vacio en vez de un texto generico tipo "Tenant principal".
    ms_tenant_name: str = ""
    # Mail.Send se sumo para poder enviar el correo de cierre de un
    # expediente (con el PDF adjunto) -- unica escritura real hacia Graph en
    # todo el proyecto, el resto sigue siendo estrictamente lectura.
    ms_scope: str = "openid profile offline_access User.Read Mail.Read Mail.Send"

    # URL publica (alcanzable desde el navegador del usuario, no desde la red
    # interna de Docker) por la que Microsoft redirige de vuelta tras el
    # login. Debe coincidir exactamente con un "Redirect URI" registrado en
    # la app de Azure AD (Authentication > Web > Redirect URIs).
    public_base_url: str = "http://localhost:8002"

    # Margen de seguridad antes de considerar un access token vencido y
    # renovarlo proactivamente (Microsoft los emite con ~1h de vigencia).
    token_refresh_margin_seconds: int = 300

    # Mismo secreto compartido que ya usan los webhooks de n8n (ver
    # backend/app/config.py) -- las rutas /internal/* (las llama el backend
    # y n8n directo por la red de Docker) ahora lo exigen en vez de confiar
    # solo en que no estan mapeadas en proxy/nginx.conf (ver docs/SECURITY.md).
    webhook_shared_secret: str = ""
    webhook_shared_secret_header: str = "X-MailingAI-Secret"

    # Mismo nombre de cookie que setea backend/app/config.py -- el broker
    # comparte origen (todo detras de proxy/nginx.conf) y misma base Postgres,
    # asi que puede leer y validar la sesion sin llamar de vuelta al backend.
    session_cookie_name: str = "mailingai_session"

    # Clave Fernet (32 bytes url-safe base64, generar con
    # `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)
    # para cifrar access_token/refresh_token de Graph en reposo -- antes se
    # guardaban en texto plano en identity.mailbox_accounts. Sin esto el
    # servicio no arranca (ver app/crypto.py) porque esos tokens dan lectura
    # y ENVIO de correo real (scope Mail.Send) para cualquier buzon conectado.
    mailbox_token_encryption_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
