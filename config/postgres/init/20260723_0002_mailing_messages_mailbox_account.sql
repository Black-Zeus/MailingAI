-- =============================================================================
-- Mailing AI - mailbox_account_id en mailing.messages y mailing.fetch_runs
--
-- Etiqueta de que cuenta (identity.mailbox_accounts) vino cada mensaje/corrida
-- de fetch. Migracion aditiva (FK nullable): no rompe filas existentes, que
-- quedan sin etiquetar hasta que se registre el buzon actual a traves del
-- nuevo flujo del identity-broker y se haga el backfill manual (ver PLAN.md,
-- entrada 5.43).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.fetch_runs
  ADD COLUMN IF NOT EXISTS mailbox_account_id bigint REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE SET NULL;

ALTER TABLE mailing.messages
  ADD COLUMN IF NOT EXISTS mailbox_account_id bigint REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_account
  ON mailing.messages (mailbox_account_id);

CREATE INDEX IF NOT EXISTS idx_fetch_runs_mailbox_account
  ON mailing.fetch_runs (mailbox_account_id);

COMMENT ON COLUMN mailing.messages.mailbox_account_id IS 'De que cuenta (identity.mailbox_accounts) vino este mensaje. Nulo = trafico anterior a multi-buzon, sin etiquetar.';
COMMENT ON COLUMN mailing.fetch_runs.mailbox_account_id IS 'Contra que cuenta (identity.mailbox_accounts) corrio este fetch. Nulo = trafico anterior a multi-buzon, sin etiquetar.';
