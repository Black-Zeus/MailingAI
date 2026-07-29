-- =============================================================================
-- Mailing AI - Busqueda de texto completo sobre asunto + cuerpo del mensaje.
-- Objetivo explicito del usuario: reemplazar la busqueda lenta/poco confiable
-- de Outlook por algo real sobre lo ya indexado (subject + body_content).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(body_content, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON mailing.messages USING gin (search_vector);

COMMENT ON COLUMN mailing.messages.search_vector IS 'tsvector generado (asunto con peso A, cuerpo con peso B) para busqueda de texto completo via websearch_to_tsquery. Se recalcula solo al actualizar subject/body_content (columna GENERATED).';
