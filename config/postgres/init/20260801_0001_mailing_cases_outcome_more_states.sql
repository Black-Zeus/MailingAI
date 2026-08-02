-- =============================================================================
-- Mailing AI - Tres conclusiones nuevas para la revision de un expediente.
--
-- "sin_hallazgos" venia usandose para dos situaciones muy distintas: casos
-- donde literalmente no habia nada que revisar, y casos donde SI hubo un
-- indicio real (ej. hit contra un IOC) que se investigo a fondo y se
-- descarto como compromiso. Esa ambiguedad motivo separar la segunda
-- situacion en su propia conclusion:
--
--   investigado_sin_compromiso: hubo indicios/alertas reales, se investigaron,
--     no se confirmo compromiso. A diferencia de "sin_hallazgos", esta
--     conclusion NO bloquea el analisis de IA ni el cierre manual (ver
--     app/services/ai/gateway.py y cases_service.update_case, que solo
--     restringen el literal 'sin_hallazgos') -- el caso puede seguir
--     reanalizandose si se agregan notas nuevas.
--   falso_positivo: la alerta o indicador que origino el caso resulto ser
--     incorrecto o no aplicable (firma desactualizada, IOC mal identificado,
--     coincidencia no relacionada) -- distinto de "investigado_sin_compromiso",
--     donde el indicio si era real.
--   mitigado: hubo compromiso confirmado (con_hallazgos) pero ya se aplico
--     la remediacion y el caso quedo resuelto.
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
    'investigado_sin_compromiso', 'falso_positivo', 'mitigado'
  ));

COMMENT ON COLUMN mailing.cases.outcome IS 'Conclusion de la revision, independiente de status (abierto/cerrado): con_hallazgos, sin_hallazgos, pendiente, en_proceso, derivado, mas_antecedentes, investigado_sin_compromiso, falso_positivo, mitigado. NULL mientras no se defina.';
