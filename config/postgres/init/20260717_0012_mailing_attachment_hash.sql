-- =============================================================================
-- Mailing AI - Hash (SHA-256) del contenido real de cada adjunto, para poder
-- tratarlo como evidencia integra (comprobar despues que el archivo servido
-- es exactamente el mismo que se descargo la primera vez).
--
-- El hash se calcula recien la primera vez que alguien descarga el adjunto
-- (el contenido real solo se trae de Graph bajo demanda, via el workflow 08 -
-- no en la indexacion masiva, para no repetir el problema de MailboxConcurrency
-- ya resuelto -- ver nota tecnica 16 de n8n/WorkFlows/README.md). Queda NULL
-- para adjuntos que todavia nadie abrio.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.message_attachments
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS content_sha256_computed_at timestamptz;

COMMENT ON COLUMN mailing.message_attachments.content_sha256 IS 'SHA-256 hexadecimal del contenido real del adjunto, calculado la primera vez que se descarga (no en la indexacion). NULL si nadie lo descargo todavia.';
