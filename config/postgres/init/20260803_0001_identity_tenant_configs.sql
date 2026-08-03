-- =============================================================================
-- Mailing AI - Registro de tenants de Microsoft Entra ID (Azure AD).
--
-- Hasta ahora un unico tenant/App Registration vivia en variables de entorno
-- (MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET, ver identity-broker/app/config.py)
-- y todo buzon conectado usaba siempre esas mismas credenciales. Esta tabla
-- permite registrar N tenants desde la UI (Configuracion, solo admin) y elegir
-- a cual pertenece cada buzon nuevo al conectarlo.
--
-- El login SSO de usuarios para entrar a la app (backend/app/auth/ms_login.py)
-- sigue usando exclusivamente las variables de entorno globales -- fuera de
-- alcance de esta migracion, decision explicita (ver docs/AZURE_SETUP.md).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver docs/INSTALL.md).
-- =============================================================================

CREATE TABLE IF NOT EXISTS identity.tenant_configs (
  tenant_config_id bigserial PRIMARY KEY,
  label text NOT NULL,
  ms_tenant_id text NOT NULL,
  ms_client_id text NOT NULL,
  ms_client_secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity.tenant_configs IS 'Tenants de Microsoft Entra ID registrados -- cada uno con su propia App Registration (tenant id / client id / client secret). ms_client_secret nunca se devuelve por API, solo se usa internamente en el flujo OAuth2.';
COMMENT ON COLUMN identity.tenant_configs.is_active IS 'Tenants inactivos no aparecen como opcion al conectar un buzon nuevo, pero los buzones ya conectados con ese tenant siguen funcionando (el refresh de token usa las credenciales guardadas en la propia fila de identity.mailbox_accounts, no esta tabla).';

-- El buzon guarda ademas su propio tenant_id/client_id/client_secret
-- (columnas ya existentes, ver 20260723_0001) -- son la fuente de verdad real
-- para el refresh de tokens, copiadas desde el tenant elegido al momento de
-- conectar. Este FK es solo trazabilidad/UI (que tenant registrado se uso),
-- por eso queda nullable y en SET NULL: borrar un tenant_config no debe
-- romper ni desconectar los buzones que ya se conectaron con el.
ALTER TABLE identity.mailbox_accounts
  ADD COLUMN IF NOT EXISTS tenant_config_id bigint REFERENCES identity.tenant_configs(tenant_config_id) ON DELETE SET NULL;
