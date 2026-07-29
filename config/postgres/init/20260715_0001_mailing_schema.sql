-- =============================================================================
-- Mailing AI
-- Schema para el analisis de actividad del buzon via Microsoft Graph API:
-- corridas de fetch parametrizadas, mensajes normalizados (enviados y
-- relacionados por hilo/conversation_id) y corridas de generacion de graficos.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Es idempotente, por lo que tambien se puede aplicar manualmente sobre una
-- base de datos existente.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS mailing;

CREATE TABLE IF NOT EXISTS mailing.fetch_runs (
  run_id bigserial PRIMARY KEY,
  workflow_execution_id text,
  folder text NOT NULL DEFAULT 'sentitems',
  date_from timestamptz,
  date_to timestamptz,
  search_query text,
  filter_description text,
  top_requested integer,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'success', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_messages integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mailing.messages (
  message_id text PRIMARY KEY,
  run_id bigint REFERENCES mailing.fetch_runs(run_id) ON DELETE SET NULL,
  conversation_id text,
  internet_message_id text,
  subject text,
  from_address text,
  from_name text,
  to_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_datetime timestamptz,
  received_datetime timestamptz,
  has_attachments boolean NOT NULL DEFAULT false,
  importance text,
  is_sent boolean NOT NULL DEFAULT true,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  body_preview text,
  web_link text,
  raw_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON mailing.messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_sent_datetime
  ON mailing.messages (sent_datetime DESC);

CREATE INDEX IF NOT EXISTS idx_messages_from_address
  ON mailing.messages (from_address);

CREATE INDEX IF NOT EXISTS idx_messages_raw_gin
  ON mailing.messages USING gin (raw_record);

CREATE TABLE IF NOT EXISTS mailing.chart_runs (
  chart_id bigserial PRIMARY KEY,
  chart_type text NOT NULL CHECK (chart_type IN ('timeline', 'histogram')),
  run_id bigint REFERENCES mailing.fetch_runs(run_id) ON DELETE SET NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_file text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW mailing.v_messages_by_day AS
SELECT
  date_trunc('day', sent_datetime)::date AS day,
  count(*) AS message_count
FROM mailing.messages
WHERE sent_datetime IS NOT NULL
GROUP BY date_trunc('day', sent_datetime)::date
ORDER BY day;

CREATE OR REPLACE VIEW mailing.v_messages_by_sender AS
SELECT
  coalesce(from_address, 'desconocido') AS from_address,
  max(from_name) AS from_name,
  count(*) AS message_count
FROM mailing.messages
GROUP BY coalesce(from_address, 'desconocido')
ORDER BY message_count DESC;

CREATE OR REPLACE VIEW mailing.v_conversation_summary AS
SELECT
  conversation_id,
  count(*) AS message_count,
  min(sent_datetime) AS first_message_at,
  max(sent_datetime) AS last_message_at,
  jsonb_agg(DISTINCT from_address) FILTER (WHERE from_address IS NOT NULL) AS participants
FROM mailing.messages
WHERE conversation_id IS NOT NULL
GROUP BY conversation_id;

COMMENT ON SCHEMA mailing IS 'Actividad del buzon de correo (Microsoft Graph): corridas de fetch, mensajes normalizados y graficos generados.';
COMMENT ON TABLE mailing.fetch_runs IS 'Trazabilidad de cada ejecucion de fetch contra Graph API (carpeta, filtros, resultado).';
COMMENT ON TABLE mailing.messages IS 'Mensajes normalizados. Upsert por message_id desde n8n. is_sent distingue enviados de correos relacionados encontrados en otras carpetas.';
COMMENT ON TABLE mailing.chart_runs IS 'Corridas de generacion de graficos (histograma/linea de tiempo) contra el backend FastAPI.';
