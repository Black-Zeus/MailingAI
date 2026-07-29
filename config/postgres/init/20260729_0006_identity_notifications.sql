-- =============================================================================
-- Mailing AI - Notificaciones in-app (compartir expediente/buzon).
--
-- No hay una cuenta de correo de "sistema" separada de los buzones reales de
-- Microsoft, asi que un aviso automatico no puede salir como email real sin
-- pedir prestado el buzon de alguien -- confuso. En su lugar, un aviso
-- visible dentro de la app (campanita en el sidebar) cuando a alguien le
-- comparten un expediente o un buzon.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS identity.notifications (
  notification_id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('case_shared', 'mailbox_shared')),
  message text NOT NULL,
  case_id bigint REFERENCES mailing.cases(case_id) ON DELETE SET NULL,
  mailbox_account_id bigint REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE SET NULL,
  created_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON identity.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

COMMENT ON TABLE identity.notifications IS 'Avisos in-app (no email real -- no hay cuenta de sistema separada de los buzones de Microsoft). Se crean al compartir un expediente o buzon con un usuario.';
