-- =============================================================================
-- Mailing AI - Login local (usuario/contraseña) como segundo metodo de
-- autenticacion, ademas de SSO Microsoft/Entra ID.
--
-- Igual que el login SSO, sin auto-registro: una cuenta local solo la puede
-- crear un administrador (ver POST /api/admin/users con auth_method=local),
-- que fija la contraseña inicial. La cuenta queda marcada para forzar un
-- cambio de contraseña en el primer login (must_change_password=true).
--
-- auth_method distingue el tipo de cuenta de forma explicita (no se infiere
-- de que columnas esten NULL): 'sso' sigue usando ms_object_id/email_address
-- como hasta ahora (username/password_hash quedan NULL); 'local' usa
-- username/password_hash (ms_object_id queda NULL para siempre -- nunca se
-- vincula via SSO). email_address se mantiene obligatorio para ambos tipos
-- (se sigue usando para notificaciones y para compartir expedientes/buzones).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'sso',
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_auth_method_check;
ALTER TABLE identity.users
  ADD CONSTRAINT users_auth_method_check CHECK (auth_method IN ('sso', 'local'));

-- Consistencia: una cuenta SSO nunca tiene username/password_hash, una
-- cuenta local siempre los tiene (y nunca queda vinculada a un ms_object_id).
ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_auth_method_fields_check;
ALTER TABLE identity.users
  ADD CONSTRAINT users_auth_method_fields_check CHECK (
    (auth_method = 'sso' AND username IS NULL AND password_hash IS NULL)
    OR
    (auth_method = 'local' AND username IS NOT NULL AND password_hash IS NOT NULL AND ms_object_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON identity.users (lower(username))
  WHERE username IS NOT NULL;

COMMENT ON COLUMN identity.users.auth_method IS 'sso (Microsoft/Entra ID, default) o local (usuario/contraseña, alta exclusiva por un admin). Determina que columnas de credencial aplican -- ver users_auth_method_fields_check.';
COMMENT ON COLUMN identity.users.username IS 'Solo para auth_method=local. Independiente de email_address (que sigue siendo obligatorio para notificaciones/compartir).';
COMMENT ON COLUMN identity.users.password_hash IS 'Hash Argon2id (argon2-cffi). Solo para auth_method=local. Nunca se guarda la contraseña en claro.';
COMMENT ON COLUMN identity.users.must_change_password IS 'true fuerza el cambio de contraseña en el proximo login antes de poder usar el resto de la app -- se activa al crear la cuenta o al resetear la contraseña desde el panel de admin.';
