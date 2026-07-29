-- =============================================================================
-- Mailing AI - Nueva conclusion de revision "en_proceso" (revision activa,
-- distinta de "pendiente" que significa que todavia no se ha empezado).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases DROP CONSTRAINT IF EXISTS cases_outcome_check;

ALTER TABLE mailing.cases
  ADD CONSTRAINT cases_outcome_check
  CHECK (outcome IN ('con_hallazgos', 'sin_hallazgos', 'pendiente', 'en_proceso', 'derivado', 'mas_antecedentes'));

COMMENT ON COLUMN mailing.cases.outcome IS 'Conclusion de la revision, independiente de status (abierto/cerrado): con_hallazgos, sin_hallazgos, pendiente, en_proceso, derivado, mas_antecedentes. NULL mientras no se defina.';
