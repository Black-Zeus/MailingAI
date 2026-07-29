-- =============================================================================
-- Mailing AI - Dueño y compartición de cuentas de buzon.
--
-- Quien registra/conecta una cuenta (completa el consentimiento OAuth2) queda
-- como su dueño automaticamente -- ver endpoint POST /api/mailboxes/{id}/claim
-- en el backend. Un buzon puede compartirse ademas con otros usuarios via
-- identity.mailbox_shares (solo lectura de sus mensajes), otorgado por el
-- dueño o por un admin.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE identity.mailbox_accounts
  ADD COLUMN IF NOT EXISTS owner_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_accounts_owner ON identity.mailbox_accounts (owner_user_id);

CREATE TABLE IF NOT EXISTS identity.mailbox_shares (
  mailbox_account_id bigint NOT NULL REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'read' CHECK (permission IN ('read')),
  shared_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox_account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_shares_user ON identity.mailbox_shares (user_id);

COMMENT ON COLUMN identity.mailbox_accounts.owner_user_id IS 'Quien registro/conecto la cuenta. Se asigna automaticamente al completar el OAuth2 (ver POST /api/mailboxes/{id}/claim). NULL = cuenta preexistente sin dueño, visible solo para admin hasta que se reclame o reasigne.';
COMMENT ON TABLE identity.mailbox_shares IS 'Acceso de lectura a los mensajes de un buzon otorgado a un usuario que no es su dueño (ej. un supervisor). Solo el dueño o un admin puede otorgar/revocar.';
