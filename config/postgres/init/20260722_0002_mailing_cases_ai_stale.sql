-- =============================================================================
-- Mailing AI - Ciclo de vida abierto/cerrado + IA obsoleta para expedientes.
-- Reglas de negocio pedidas por el usuario:
--   1. Un expediente cerrado no admite ninguna mutacion (agregar/quitar
--      correo, nota, re-correlacionar, analizar con IA, cambiar conclusion)
--      salvo eliminarlo -- hay que reabrirlo primero.
--   2. Reabierto, si se agrega una nota o se agrega/quita un correo, el
--      ultimo analisis de IA queda "obsoleto" (ai_stale = true).
--   3. Un analisis de IA exitoso cierra el expediente automaticamente y
--      limpia ai_stale.
--   4. Un expediente marcado outcome = 'sin_hallazgos' no admite analisis de
--      IA ni cierre manual (ya esta en un estado terminal via su conclusion).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS ai_stale boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mailing.cases.ai_stale IS 'true si el expediente cambio (nota/correo agregado o quitado) despues del ultimo analisis de IA exitoso -- se limpia al volver a analizar con exito.';

-- CREATE OR REPLACE VIEW es seguro aca porque solo se agrega una columna al
-- final (nunca se puede reordenar/quitar con REPLACE, pero agregar si).
CREATE OR REPLACE VIEW mailing.v_case_summary AS
SELECT
  c.case_id,
  c.case_type,
  c.external_code,
  c.title,
  c.status,
  c.confidence,
  count(DISTINCT cm.message_id) AS message_count,
  min(m.sent_datetime) AS first_message_at,
  max(m.sent_datetime) AS last_message_at,
  c.outcome,
  EXISTS (
    SELECT 1 FROM mailing.ai_runs ar
    WHERE ar.case_id = c.case_id AND ar.status = 'success'
  ) AS has_successful_ai_run,
  c.ai_stale
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome, c.ai_stale;
