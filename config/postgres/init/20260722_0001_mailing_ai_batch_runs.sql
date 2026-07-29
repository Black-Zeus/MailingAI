-- =============================================================================
-- Mailing AI - Corridas en lote de "Procesar todo con IA".
-- Objetivo: que el progreso de un analisis masivo de expedientes sobreviva a
-- un refresh/cierre de pestana del navegador -- antes era un loop puro en el
-- frontend (se perdia el progreso, aunque no el trabajo ya hecho, al
-- refrescar). Ahora el loop corre en el backend via BackgroundTasks, y el
-- estado real vive aca para que el frontend pueda reconectarse y mostrar el
-- avance real en cualquier momento, sin depender de que la pestana siguiera
-- abierta.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.ai_batch_runs (
  batch_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed')),
  total_cases integer NOT NULL DEFAULT 0,
  processed_cases integer NOT NULL DEFAULT 0,
  succeeded_cases integer NOT NULL DEFAULT 0,
  failed_cases integer NOT NULL DEFAULT 0,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_batch_runs_requested_at
  ON mailing.ai_batch_runs (requested_at DESC);

COMMENT ON TABLE mailing.ai_batch_runs IS 'Estado de cada corrida de "Procesar todo con IA" -- vive en el backend (BackgroundTasks), no en el navegador, para sobrevivir un refresh/cierre de pestana.';
