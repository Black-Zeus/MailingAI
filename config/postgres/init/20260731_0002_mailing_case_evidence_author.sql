-- =============================================================================
-- Mailing AI - Autor de cada evidencia adjunta a un expediente
-- mailing.case_evidence no registraba quien subio cada evidencia -- se agrega
-- para poder mostrar "Autor" en el PDF exportado (ver notas_pdf.txt, seccion
-- 4: la evidencia debe indicar quien la incorporo). Evidencia ya existente
-- queda con created_by_user_id NULL -- el PDF muestra "No registrado" para
-- esas filas en vez de inventar un autor.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.case_evidence
  ADD COLUMN IF NOT EXISTS created_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN mailing.case_evidence.created_by_user_id IS 'Usuario que subio esta evidencia. NULL = evidencia previa a este campo (no registrada), se muestra como "No registrado" en el PDF.';
