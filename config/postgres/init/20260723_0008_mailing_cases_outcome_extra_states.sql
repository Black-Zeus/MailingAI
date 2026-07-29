-- =============================================================================
-- Mailing AI - Dos conclusiones nuevas para la revision de un expediente.
-- Se suman "derivado" (Derivado a) y "mas_antecedentes" (Se solicitan mas
-- antecedentes) a las 3 que ya existian (con_hallazgos, sin_hallazgos,
-- pendiente). El detalle de a quien se derivo o que antecedentes se piden
-- va en una nota del expediente, igual que el resto de la conclusion --
-- estos valores solo marcan el estado, no llevan texto libre propio.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases DROP CONSTRAINT IF EXISTS cases_outcome_check;

ALTER TABLE mailing.cases
  ADD CONSTRAINT cases_outcome_check
  CHECK (outcome IN ('con_hallazgos', 'sin_hallazgos', 'pendiente', 'derivado', 'mas_antecedentes'));

COMMENT ON COLUMN mailing.cases.outcome IS 'Conclusion de la revision, independiente de status (abierto/cerrado): con_hallazgos, sin_hallazgos, pendiente, derivado, mas_antecedentes. NULL mientras no se defina.';
