-- =============================================================================
-- Mailing AI - Broker de identidad: cuentas de buzon registradas fuera de n8n
-- (mesa + agentes de mesa, mismo tenant O365 por ahora). Reemplaza la
-- credencial OAuth2 nativa de n8n como duena de los tokens: el servicio
-- identity-broker (contenedor nuevo, fuera de este backend) es el unico
-- lector/escritor de este schema.
--
-- A diferencia de mailing.ai_providers (exactamente un proveedor activo),
-- aca pueden convivir varias cuentas habilitadas al mismo tiempo -- ese es
-- el caso de uso real (buzon de mesa + N buzones de agentes).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.mailbox_accounts (
  mailbox_account_id bigserial PRIMARY KEY,
  label text NOT NULL,
  email_address text,
  provider text NOT NULL DEFAULT 'microsoft' CHECK (provider IN ('microsoft')),
  tenant_id text,
  client_id text,
  client_secret text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_accounts_enabled
  ON identity.mailbox_accounts (enabled);

-- Evita duplicar la misma cuenta si se repite el consentimiento (reconectar
-- reemplaza los tokens de la fila existente en vez de crear una nueva).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_accounts_provider_email
  ON identity.mailbox_accounts (provider, email_address)
  WHERE email_address IS NOT NULL;

COMMENT ON SCHEMA identity IS 'Identidad/credenciales de cuentas de buzon conectadas (broker OAuth2), separado del schema mailing que solo guarda datos ya normalizados.';
COMMENT ON TABLE identity.mailbox_accounts IS 'Cuentas de buzon registradas via el flujo OAuth2 del identity-broker. Varias pueden estar enabled a la vez (mesa + agentes). client_secret/access_token/refresh_token nunca se exponen fuera del broker.';
COMMENT ON COLUMN identity.mailbox_accounts.provider IS 'Hoy solo microsoft (delegado, /me). Diseñado para admitir otros proveedores (ej. google) mas adelante sin romper esta tabla.';
