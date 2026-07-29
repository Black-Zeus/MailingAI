-- =============================================================================
-- Mailing AI - Carpetas de correo (Fase 4)
-- Descubrimiento de carpetas/subcarpetas del buzon via Microsoft Graph
-- (/me/mailFolders), con ruta logica y relacion padre/hijo. Ademas, vincula
-- cada mensaje con la carpeta donde vive (mailing.messages.folder_id).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- No modifica ni elimina tablas/vistas existentes, solo agrega.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.mail_folders (
  folder_id text PRIMARY KEY,
  parent_folder_id text REFERENCES mailing.mail_folders(folder_id) ON DELETE SET NULL,
  display_name text NOT NULL,
  folder_path text,
  child_folder_count integer NOT NULL DEFAULT 0,
  total_item_count integer NOT NULL DEFAULT 0,
  last_sync_at timestamptz,
  delta_link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mail_folders_parent
  ON mailing.mail_folders (parent_folder_id);

ALTER TABLE mailing.messages
  ADD COLUMN IF NOT EXISTS folder_id text REFERENCES mailing.mail_folders(folder_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_folder_id
  ON mailing.messages (folder_id);

ALTER TABLE mailing.analysis_jobs DROP CONSTRAINT IF EXISTS analysis_jobs_job_type_check;
ALTER TABLE mailing.analysis_jobs ADD CONSTRAINT analysis_jobs_job_type_check CHECK (job_type IN (
  'fetch_sent_items',
  'fetch_message_series',
  'fetch_related_thread',
  'fetch_cr_attachments',
  'generate_activity_charts',
  'discover_mail_folders'
));

CREATE OR REPLACE VIEW mailing.v_mail_folders_tree AS
WITH RECURSIVE tree AS (
  SELECT
    folder_id,
    parent_folder_id,
    display_name,
    display_name::text AS computed_path,
    0 AS depth
  FROM mailing.mail_folders
  WHERE parent_folder_id IS NULL
     OR parent_folder_id NOT IN (SELECT folder_id FROM mailing.mail_folders)

  UNION ALL

  SELECT
    f.folder_id,
    f.parent_folder_id,
    f.display_name,
    (tree.computed_path || ' / ' || f.display_name)::text AS computed_path,
    tree.depth + 1
  FROM mailing.mail_folders f
  JOIN tree ON f.parent_folder_id = tree.folder_id
)
SELECT folder_id, parent_folder_id, display_name, computed_path, depth
FROM tree
ORDER BY computed_path;

COMMENT ON TABLE mailing.mail_folders IS 'Carpetas/subcarpetas del buzon descubiertas via Graph (/me/mailFolders). folder_path se guarda tal como lo arma n8n al recorrer el arbol; v_mail_folders_tree la recalcula en SQL como respaldo/verificacion.';
COMMENT ON COLUMN mailing.messages.folder_id IS 'Carpeta de origen del mensaje (mailing.mail_folders.folder_id). Nulo para mensajes traidos antes de la Fase 4 o cuando el workflow de origen no resuelve carpeta (ej. busqueda directa en Sent Items).';
