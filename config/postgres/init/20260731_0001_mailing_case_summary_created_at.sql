-- =============================================================================
-- Mailing AI - Expone created_at en mailing.v_case_summary
-- Necesario para poder ordenar expedientes por fecha de generacion en el
-- frontend (Configuracion > Expedientes, filtro/orden simple) -- la vista no
-- lo traia hasta ahora, solo first_message_at/last_message_at (fechas de los
-- correos, no del expediente en si).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

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
    SELECT 1 FROM mailing.ai_runs ar WHERE ar.case_id = c.case_id AND ar.status = 'success'
  ) AS has_successful_ai_run,
  c.ai_stale,
  EXISTS (
    SELECT 1
    FROM mailing.case_messages cm2
    JOIN mailing.messages m2 ON m2.message_id = cm2.message_id
    JOIN identity.mailbox_accounts ma ON ma.mailbox_account_id = m2.mailbox_account_id
    WHERE cm2.case_id = c.case_id AND lower(m2.from_address) = lower(ma.email_address)
  ) AS has_own_reply,
  c.owner_user_id,
  c.created_at
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome, c.ai_stale, c.owner_user_id, c.created_at;

COMMENT ON VIEW mailing.v_case_summary IS 'Resumen de expedientes para listados -- incluye created_at (fecha del expediente en si, distinta de first_message_at/last_message_at que son fechas de los correos correlacionados).';
