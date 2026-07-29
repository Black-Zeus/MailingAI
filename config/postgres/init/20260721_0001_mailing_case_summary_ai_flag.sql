-- =============================================================================
-- Mailing AI - Agrega has_successful_ai_run a v_case_summary.
-- Objetivo: permitir "Procesar todo con IA" en la UI -- saber que expedientes
-- ya tienen un analisis de IA exitoso sin tener que pedir el detalle completo
-- de cada uno (que ya trae latest_ai_run, pero es una consulta mas pesada).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

DROP VIEW IF EXISTS mailing.v_case_summary;

CREATE VIEW mailing.v_case_summary AS
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
  ) AS has_successful_ai_run
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome;

COMMENT ON VIEW mailing.v_case_summary IS 'Resumen de expedientes para listados -- has_successful_ai_run permite filtrar los que todavia no se procesaron con IA sin pedir el detalle completo de cada uno.';
