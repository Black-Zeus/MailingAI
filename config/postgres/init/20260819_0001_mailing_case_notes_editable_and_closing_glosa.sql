-- =============================================================================
-- Mailing AI - Notas del auditor: se permite editar SOLO la ultima nota del
-- expediente y solo si es propia (ver cases_service.update_case_note) --
-- excepcion puntual a la inmutabilidad definida en 20260718_0001, no la
-- reemplaza: las notas anteriores a la ultima siguen siendo inmutables.
-- Para poder validar autoria y mostrar quien la escribio se agrega
-- created_by_user_id (igual criterio que mailing.case_evidence); updated_at
-- queda NULL mientras la nota no se haya editado nunca.
--
-- De paso se agrega mailing.cases.closing_glosa: texto libre obligatorio al
-- cerrar un expediente (ver cases_service.update_case), para dejar constancia
-- del motivo real del cierre (derivado, escalado, falta de evidencia, ya
-- entregado, etc.) -- separado de "outcome" (conclusion fija) y de
-- "pending_action" (que falta hacer).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.case_notes
  ADD COLUMN IF NOT EXISTS created_by_user_id bigint REFERENCES identity.users(user_id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON COLUMN mailing.case_notes.created_by_user_id IS 'Autor de la nota -- NULL en notas creadas antes de esta migracion (no se puede reconstruir su autoria, quedan no editables).';
COMMENT ON COLUMN mailing.case_notes.updated_at IS 'NULL si la nota nunca se edito. Solo la ultima nota del expediente es editable, y solo por su autor.';

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS closing_glosa text;

COMMENT ON COLUMN mailing.cases.closing_glosa IS 'Glosa de cierre: motivo por el que se cierra el expediente (derivado, escalado, falta de evidencia, ya entregado, etc.). Obligatoria para pasar de open a closed -- ver cases_service.update_case.';

-- CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, nunca
-- reordenar/quitar -- esta definicion es una copia exacta de la vigente
-- (20260813_0002_mailing_cases_pending_reopen_count.sql) mas la columna
-- nueva al final del SELECT y del GROUP BY.
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
  c.closing_glosa
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome,
         c.ai_stale, c.owner_user_id, c.created_at, c.pending_action, c.next_review_at,
         c.previous_owner_label, c.updated_at, c.pending_reopen_message_count, c.closing_glosa;
