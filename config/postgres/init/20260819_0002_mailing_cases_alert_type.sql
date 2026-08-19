-- =============================================================================
-- Mailing AI - Tipo de alerta del expediente (texto libre editable, ej.
-- "Phishing", "Exfiltracion de datos", "Acceso no autorizado"). Se agrega
-- porque la plantilla de correo "Reporte estandar CyberSOC" usa el token
-- [TIPO_DE_ALERTA] en el asunto y no existia ningun campo del expediente que
-- lo pudiera completar solo -- quedaba siempre vacio (ver
-- mail_templates_service._build_auto_variables, que ahora lo incluye como
-- variable automatica igual que CONCLUSION/TITULO/etc).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS alert_type text;

COMMENT ON COLUMN mailing.cases.alert_type IS 'Tipo de alerta del expediente (texto libre, ej. Phishing, Exfiltracion de datos) -- variable automatica TIPO_DE_ALERTA en plantillas de correo.';

-- CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, nunca
-- reordenar/quitar -- esta definicion es una copia exacta de la vigente
-- (20260819_0001_mailing_case_notes_editable_and_closing_glosa.sql) mas la
-- columna nueva al final del SELECT y del GROUP BY.
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
  (EXISTS (
      SELECT 1 FROM mailing.ai_runs ar
      WHERE ar.case_id = c.case_id AND ar.status = 'success'
  )) AS has_successful_ai_run,
  c.ai_stale,
  (EXISTS (
      SELECT 1 FROM mailing.case_messages cm2
      JOIN mailing.messages m2 ON m2.message_id = cm2.message_id
      JOIN identity.mailbox_accounts ma ON ma.mailbox_account_id = m2.mailbox_account_id
      WHERE cm2.case_id = c.case_id AND lower(m2.from_address) = lower(ma.email_address)
  )) AS has_own_reply,
  c.owner_user_id,
  c.created_at,
  c.pending_action,
  c.next_review_at,
  c.previous_owner_label,
  c.updated_at,
  c.pending_reopen_message_count,
  c.closing_glosa,
  c.alert_type
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome,
         c.ai_stale, c.owner_user_id, c.created_at, c.pending_action, c.next_review_at,
         c.previous_owner_label, c.updated_at, c.pending_reopen_message_count, c.closing_glosa,
         c.alert_type;
