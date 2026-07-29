-- =============================================================================
-- Mailing AI - Dueño y compartición de expedientes; buzon de cada carpeta.
--
-- Cada expediente pasa a tener un owner_user_id (quien lo creo) y puede
-- compartirse explicitamente con otros usuarios via mailing.case_shares, con
-- permiso read|edit. El dueño y los admin siempre tienen acceso total sin
-- necesitar fila en case_shares.
--
-- Tambien cierra un hueco preexistente: mailing.mail_folders no sabia de que
-- buzon era cada carpeta (folder_id es unico por buzon en Graph, pero la
-- tabla es global) -- sin esto no se puede filtrar /api/mail-folders segun
-- los buzones a los que el usuario tiene acceso.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS owner_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cases_owner ON mailing.cases (owner_user_id);

CREATE TABLE IF NOT EXISTS mailing.case_shares (
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'edit')),
  shared_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_case_shares_user ON mailing.case_shares (user_id);

ALTER TABLE mailing.mail_folders
  ADD COLUMN IF NOT EXISTS mailbox_account_id bigint REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE SET NULL;

-- Backfill por mejor esfuerzo: para cada folder_id, el mailbox_account_id del
-- mensaje mas reciente que lo referencia. Deja NULL las carpetas huerfanas
-- (sin mensajes indexados todavia) -- quedan visibles solo para admin hasta
-- que un fetch nuevo las asocie.
UPDATE mailing.mail_folders f
SET mailbox_account_id = sub.mailbox_account_id
FROM (
  SELECT DISTINCT ON (folder_id) folder_id, mailbox_account_id
  FROM mailing.messages
  WHERE folder_id IS NOT NULL AND mailbox_account_id IS NOT NULL
  ORDER BY folder_id, sent_datetime DESC
) sub
WHERE f.folder_id = sub.folder_id AND f.mailbox_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mail_folders_mailbox_account ON mailing.mail_folders (mailbox_account_id);

COMMENT ON COLUMN mailing.cases.owner_user_id IS 'Dueño del expediente (quien lo creo). NULL = expediente preexistente a la introduccion de multiusuario, visible solo para admin hasta que se le asigne un dueño.';
COMMENT ON TABLE mailing.case_shares IS 'Expedientes compartidos explicitamente con otros usuarios, con permiso read|edit. El dueño y los admin siempre tienen acceso total sin necesitar fila aca.';
COMMENT ON COLUMN mailing.mail_folders.mailbox_account_id IS 'A que buzon pertenece la carpeta. Backfill por mejor esfuerzo desde mailing.messages; NULL = ambiguo/preexistente, visible solo para admin.';
