-- =============================================================================
-- Mailing AI - Cursor de sincronizacion incremental (delta) por buzon.
--
-- Hasta ahora la unica indexacion es manual y siempre re-lee todo el buzon
-- desde el año 2000 (mailbox_index_service._EPOCH_DATE_FROM). Esta columna
-- guarda hasta que fecha quedo sincronizado cada buzon, para que un workflow
-- diario en n8n pueda traer solo los mensajes nuevos/modificados desde la
-- ultima corrida en vez de reindexar todo el historial cada vez. NULL =
-- nunca sincronizado por delta (se trata como epoca 2000-01-01).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE identity.mailbox_accounts ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

COMMENT ON COLUMN identity.mailbox_accounts.last_synced_at IS 'Hasta que fecha quedo sincronizado este buzon por el workflow de delta sync (n8n). NULL = nunca, se trata como epoca 2000-01-01.';
