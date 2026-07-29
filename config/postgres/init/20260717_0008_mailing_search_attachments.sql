-- =============================================================================
-- Mailing AI - Busqueda de adjuntos por carpeta(s) + patron (a pedido del
-- usuario): nuevo job_type 'search_attachments'. A diferencia de
-- fetch_cr_attachments (fijo a Enviados + keyword + formatos PDF/Word/etc),
-- este permite elegir una o varias carpetas del arbol y un patron opcional
-- (texto libre o regex) contra el nombre del adjunto, sin filtrar por formato.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.analysis_jobs DROP CONSTRAINT IF EXISTS analysis_jobs_job_type_check;
ALTER TABLE mailing.analysis_jobs ADD CONSTRAINT analysis_jobs_job_type_check CHECK (job_type IN (
  'fetch_sent_items',
  'fetch_message_series',
  'fetch_related_thread',
  'fetch_cr_attachments',
  'generate_activity_charts',
  'discover_mail_folders',
  'search_attachments'
));
