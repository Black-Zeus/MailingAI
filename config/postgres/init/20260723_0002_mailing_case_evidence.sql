-- =============================================================================
-- Mailing AI - Evidencia adjunta por el auditor a un expediente
-- Imagenes que el auditor sube manualmente como respaldo de su analisis
-- (capturas de pantalla, etc.), listadas en el PDF exportado del expediente
-- como fecha y hora | glosa | evidencia, una por linea.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.case_evidence (
  evidence_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  glosa text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_evidence_case_id
  ON mailing.case_evidence (case_id, created_at);

COMMENT ON TABLE mailing.case_evidence IS 'Evidencia (imagenes) que el auditor adjunta a un expediente para respaldar su analisis -- se incluye en el PDF exportado, una linea por evidencia con fecha, glosa e imagen.';
