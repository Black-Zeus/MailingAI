-- =============================================================================
-- Mailing AI - Notas libres del auditor + conclusion de la revision, en cada
-- expediente. Deliberadamente separado de status (abierto/cerrado, que sigue
-- describiendo si el expediente sigue en trabajo) y del resumen de IA (que
-- es generado, no escrito por una persona).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('con_hallazgos', 'sin_hallazgos', 'pendiente'));

-- CREATE OR REPLACE VIEW solo permite agregar columnas al final, nunca
-- reordenar ni quitar las existentes -- por eso notes/outcome van al final.
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
  c.notes,
  c.outcome
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.notes, c.outcome;

COMMENT ON COLUMN mailing.cases.notes IS 'Notas libres escritas a mano por el auditor -- nunca generadas por IA, separadas del resumen automatico (latest_ai_run).';
COMMENT ON COLUMN mailing.cases.outcome IS 'Conclusion de la revision, independiente de status (abierto/cerrado): con_hallazgos, sin_hallazgos, pendiente. NULL mientras no se defina.';
