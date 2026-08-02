-- =============================================================================
-- Mailing AI - Nuevos tipos de notificacion: revision vencida y analisis de IA.
--
-- Amplia el CHECK de identity.notifications.kind (hasta ahora solo
-- case_shared/mailbox_shared) para soportar dos avisos automaticos nuevos:
-- 'case_review_due' (recordatorio diario cuando vence la "Proxima revision"
-- de un expediente, disparado desde n8n) y 'ai_analysis_done' (se dispara al
-- terminar un analisis de IA en background, para que el usuario se entere sin
-- tener que volver a abrir el expediente).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE identity.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE identity.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('case_shared', 'mailbox_shared', 'case_review_due', 'ai_analysis_done'));
