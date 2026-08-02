-- =============================================================================
-- Mailing AI - "Accion pendiente" y "Proxima revision" como campos reales del
-- expediente. Hasta ahora el PDF exportado ya mostraba estas dos etiquetas
-- (seccion "Conclusion y control de emision"), pero como texto fijo
-- ("No definida") -- nunca fueron datos capturables desde la UI. Se agregan
-- como columnas reales en mailing.cases, editables junto con la conclusion
-- de la revision, y el PDF pasa a leerlas en vez de mostrar el placeholder.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS pending_action text,
  ADD COLUMN IF NOT EXISTS next_review_at date;

-- CREATE OR REPLACE VIEW solo permite agregar columnas al final, nunca
-- reordenar ni quitar las existentes -- se replica la definicion real actual
-- (pg_get_viewdef) tal cual, solo agregando pending_action/next_review_at.
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
    SELECT 1 FROM mailing.ai_runs ar WHERE ar.case_id = c.case_id AND ar.status = 'success'
  )) AS has_successful_ai_run,
  c.ai_stale,
  (EXISTS (
    SELECT 1
    FROM mailing.case_messages cm2
    JOIN mailing.messages m2 ON m2.message_id = cm2.message_id
    JOIN identity.mailbox_accounts ma ON ma.mailbox_account_id = m2.mailbox_account_id
    WHERE cm2.case_id = c.case_id AND lower(m2.from_address) = lower(ma.email_address)
  )) AS has_own_reply,
  c.owner_user_id,
  c.created_at,
  c.pending_action,
  c.next_review_at
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome, c.ai_stale,
         c.owner_user_id, c.created_at, c.pending_action, c.next_review_at;

COMMENT ON COLUMN mailing.cases.pending_action IS 'Accion pendiente sobre el expediente (texto libre) -- se muestra en la UI y en el PDF exportado. NULL = no definida.';
COMMENT ON COLUMN mailing.cases.next_review_at IS 'Fecha en la que corresponde revisar de nuevo el expediente -- se muestra en la UI y en el PDF exportado. NULL = no definida.';
