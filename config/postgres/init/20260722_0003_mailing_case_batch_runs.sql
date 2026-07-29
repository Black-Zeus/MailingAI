-- =============================================================================
-- Mailing AI - Corridas en lote de "Crear en lote" (expedientes por codigo).
-- Mismo motivo que mailing.ai_batch_runs (20260722_0001): el progreso vivia
-- solo en el navegador -- un refresh a mitad de camino mataba el resto del
-- lote (lo ya creado no se perdia, pero lo pendiente no seguia solo). Ahora
-- corre en el backend via BackgroundTasks y el frontend puede reconectarse
-- en cualquier momento, incluso despues de un refresh.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.case_batch_runs (
  batch_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed')),
  case_type text NOT NULL,
  total_keywords integer NOT NULL DEFAULT 0,
  processed_keywords integer NOT NULL DEFAULT 0,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS mailing.case_batch_run_items (
  item_id bigserial PRIMARY KEY,
  batch_run_id uuid NOT NULL REFERENCES mailing.case_batch_runs(batch_run_id) ON DELETE CASCADE,
  position integer NOT NULL,
  keyword text NOT NULL,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'creando', 'listo', 'error')),
  detail text,
  case_id integer REFERENCES mailing.cases(case_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_case_batch_run_items_batch
  ON mailing.case_batch_run_items (batch_run_id, position);

CREATE INDEX IF NOT EXISTS idx_case_batch_runs_requested_at
  ON mailing.case_batch_runs (requested_at DESC);

COMMENT ON TABLE mailing.case_batch_runs IS 'Estado de cada corrida de "Crear en lote" -- vive en el backend (BackgroundTasks), no en el navegador, para sobrevivir un refresh/cierre de pestana.';
COMMENT ON TABLE mailing.case_batch_run_items IS 'Progreso por linea (codigo/keyword) de una corrida de mailing.case_batch_runs.';
