-- =============================================================================
-- Mailing AI - Trabajos de analisis (Fase 1)
-- Tabla de jobs asincronos creados desde el backend FastAPI. Es el modelo base
-- para que React (mas adelante) pueda crear una solicitud de trabajo, consultar
-- su progreso, y ver el resultado sin depender de que el navegador quede abierto.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mailing.analysis_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN (
    'fetch_sent_items',
    'fetch_message_series',
    'fetch_related_thread',
    'fetch_cr_attachments',
    'generate_activity_charts'
  )),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'success', 'failed', 'cancelled'
  )),
  current_stage text,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_items integer NOT NULL DEFAULT 0,
  total_items integer,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  fetch_run_id bigint REFERENCES mailing.fetch_runs(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status
  ON mailing.analysis_jobs (status);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_requested_at
  ON mailing.analysis_jobs (requested_at DESC);

COMMENT ON TABLE mailing.analysis_jobs IS 'Trabajos de analisis creados desde el backend FastAPI (Fase 1 de PLAN.md). fetch_run_id se completa cuando n8n asocia el job a una corrida concreta de mailing.fetch_runs (Fase 3, todavia no implementado).';
