-- =============================================================================
-- Mailing AI - Conclusion nueva "sin_recepcion": el caso se reporto (ej. por
-- un ticket externo), pero al armar el expediente se constata que el correo
-- nunca llego a la bandeja auditada -- no hay nada que correlacionar porque
-- la fuente misma no existe en el buzon.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases DROP CONSTRAINT IF EXISTS cases_outcome_check;

ALTER TABLE mailing.cases
  ADD CONSTRAINT cases_outcome_check
  CHECK (outcome IN (
    'con_hallazgos', 'sin_hallazgos', 'pendiente', 'en_proceso', 'derivado', 'mas_antecedentes',
    'investigado_sin_compromiso', 'falso_positivo', 'mitigado', 'sin_recepcion'
  ));

COMMENT ON COLUMN mailing.cases.outcome IS 'Conclusion de la revision, independiente de status (abierto/cerrado): con_hallazgos, sin_hallazgos, pendiente, en_proceso, derivado, mas_antecedentes, investigado_sin_compromiso, falso_positivo, mitigado, sin_recepcion. NULL mientras no se defina.';
