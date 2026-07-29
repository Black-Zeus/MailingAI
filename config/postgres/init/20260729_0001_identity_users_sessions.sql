-- =============================================================================
-- Mailing AI - Usuarios de la aplicacion y sesiones server-side.
--
-- No confundir con identity.mailbox_accounts (cuentas de buzon, credenciales
-- OAuth2 de Microsoft Graph administradas por identity-broker). Esta tabla es
-- la identidad de la PERSONA que usa la app, administrada directamente por
-- este backend (login via SSO Microsoft, alta exclusiva por un admin -- sin
-- auto-registro).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS identity.users (
  user_id bigserial PRIMARY KEY,
  ms_object_id text UNIQUE,
  email_address text NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON identity.users (lower(email_address));

CREATE TABLE IF NOT EXISTS identity.user_sessions (
  session_token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address inet,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON identity.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON identity.user_sessions (expires_at);

COMMENT ON TABLE identity.users IS 'Usuarios de la aplicacion (login via SSO Microsoft/Entra ID). Alta exclusiva por un admin: ms_object_id queda NULL hasta que la persona completa su primer login, momento en que se vincula por email. No hay auto-registro.';
COMMENT ON COLUMN identity.users.ms_object_id IS 'Claim "oid" de Azure AD. NULL = usuario pre-provisionado por un admin que todavia no inicio sesion.';
COMMENT ON COLUMN identity.users.role IS 'admin ve y gestiona todos los expedientes/buzones sin importar dueño/permisos (soporte y auditoria). user esta limitado a lo propio y lo compartido.';
COMMENT ON TABLE identity.user_sessions IS 'Sesiones server-side (no JWT). El navegador solo tiene el token opaco en una cookie httpOnly; aca se guarda unicamente su hash sha256, nunca el token en claro.';
COMMENT ON COLUMN identity.user_sessions.expires_at IS 'Ventana deslizante: se renueva en cada request valido. Ver session_ttl_seconds / session_absolute_ttl_seconds en app/config.py.';
