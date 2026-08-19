-- =============================================================================
-- Mailing AI - Marca de expedientes CERRADOS con correos nuevos relacionados
-- pendientes de vincular.
--
-- Un expediente cerrado nunca se recorrelaciona solo (refresh_case_correlation
-- exige status='open'). Sin esta columna, la unica forma de enterarse de que
-- aparecieron correos nuevos que le corresponderian era reabrirlo a mano y
-- reintentar -- ahora el refresco global (POST /cases/refresh-open) tambien
-- escanea los cerrados (sin modificarlos) y guarda cuantos correos nuevos
-- encontro, para que la UI pueda marcarlos y el usuario decida si reabrir.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS pending_reopen_message_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN mailing.cases.pending_reopen_message_count IS 'Cantidad de correos nuevos detectados para este expediente CERRADO en el ultimo escaneo global (ver cases_service.refresh_all_cases) -- 0 si no hay ninguno pendiente o si esta abierto. Se resetea a 0 al reabrir o al volver a cerrar.';

-- CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, nunca
-- reordenar/quitar -- esta definicion es una copia exacta de la vigente
-- (20260801_0012_mailing_case_summary_updated_at.sql) mas la columna nueva
-- al final del SELECT y del GROUP BY.
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
  c.pending_reopen_message_count
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome,
         c.ai_stale, c.owner_user_id, c.created_at, c.pending_action, c.next_review_at,
         c.previous_owner_label, c.updated_at, c.pending_reopen_message_count;
