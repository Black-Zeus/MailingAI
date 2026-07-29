-- =============================================================================
-- Mailing AI - Corrige un fallo real: to_tsvector() rechaza cualquier documento
-- que supere 1.048.575 bytes ("string is too long for tsvector"). Un mensaje
-- real con un body_content muy grande (HTML pesado, tabla larga, etc.) hizo
-- fallar la columna GENERATED completa, y con ella cualquier fetch/upsert que
-- lo tocara. Se trunca body_content a 200.000 caracteres antes de indexarlo
-- (margen amplio bajo el limite en bytes, incluso con texto multibyte) -- la
-- busqueda de texto completo no pierde utilidad real por no indexar cuerpos
-- extremadamente largos mas alla de ese punto.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

DROP INDEX IF EXISTS mailing.idx_messages_search_vector;

ALTER TABLE mailing.messages DROP COLUMN IF EXISTS search_vector;

ALTER TABLE mailing.messages
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(left(body_content, 200000), '')), 'B')
  ) STORED;

CREATE INDEX idx_messages_search_vector
  ON mailing.messages USING gin (search_vector);

COMMENT ON COLUMN mailing.messages.search_vector IS 'tsvector generado (asunto con peso A, cuerpo truncado a 200.000 caracteres con peso B) para busqueda de texto completo via websearch_to_tsquery. body_content se trunca porque to_tsvector rechaza documentos de mas de ~1MB. Se recalcula solo al actualizar subject/body_content (columna GENERATED).';
