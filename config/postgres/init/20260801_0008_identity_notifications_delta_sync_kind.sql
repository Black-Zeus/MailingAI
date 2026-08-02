-- =============================================================================
-- Mailing AI - Nuevo tipo de notificacion: sincronizacion delta de buzones.
--
-- Amplia el CHECK de identity.notifications.kind para soportar el aviso que
-- se dispara al terminar el workflow de sincronizacion delta de buzones
-- (n8n/WorkFlows/15-mailingai-mailbox-delta-sync.json), tanto si corrio sola
-- por el Schedule Trigger diario como si un admin la forzo a mano. Se avisa
-- a todos los administradores habilitados (in-app + correo si hay un buzon
-- remitente de notificaciones configurado).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE identity.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE identity.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('case_shared', 'mailbox_shared', 'case_review_due', 'ai_analysis_done', 'mailbox_delta_sync_done'));
