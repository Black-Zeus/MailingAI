-- =============================================================================
-- Mailing AI - Expone owner_user_id en v_case_summary.
--
-- Necesario para poder filtrar listados/detalle de expedientes por dueño
-- directamente desde la vista (ver migracion 20260729_0002, que agrego la
-- columna a mailing.cases pero no tocaba esta vista).
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
  ) AS has_successful_ai_run,
  c.ai_stale,
  EXISTS (
    SELECT 1
    FROM mailing.case_messages cm2
    JOIN mailing.messages m2 ON m2.message_id = cm2.message_id
    JOIN identity.mailbox_accounts ma ON ma.mailbox_account_id = m2.mailbox_account_id
    WHERE cm2.case_id = c.case_id
      AND lower(m2.from_address) = lower(ma.email_address)
  ) AS has_own_reply,
  c.owner_user_id
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome, c.ai_stale, c.owner_user_id;

COMMENT ON VIEW mailing.v_case_summary IS 'Resumen de expedientes para listados -- has_successful_ai_run permite filtrar los que todavia no se procesaron con IA; has_own_reply es el preanalisis rapido de si el buzon auditado ya respondio dentro del expediente; owner_user_id habilita el filtrado de acceso por dueño.';
