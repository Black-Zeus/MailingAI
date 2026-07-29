-- =============================================================================
-- Mailing AI - Corridas de IA (Fase 6)
-- Registro de cada llamada al AI Gateway: que proveedor/modelo se uso, que
-- politica de seguridad aplico, el hash de la entrada (nunca la entrada real
-- ni secretos), y el resultado estructurado. No se guardan tokens OAuth2 ni
-- credenciales de ningun proveedor aqui -- esas viven en variables de entorno.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.ai_runs (
  ai_run_id bigserial PRIMARY KEY,
  job_id uuid REFERENCES mailing.analysis_jobs(job_id) ON DELETE SET NULL,
  case_id bigint REFERENCES mailing.cases(case_id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  policy text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  output_json jsonb,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'blocked_by_policy')),
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_case
  ON mailing.ai_runs (case_id);

CREATE INDEX IF NOT EXISTS idx_ai_runs_created_at
  ON mailing.ai_runs (created_at DESC);

COMMENT ON TABLE mailing.ai_runs IS 'Trazabilidad de cada corrida de IA: proveedor, modelo, politica aplicada, hash de la entrada (nunca la entrada real ni secretos) y salida estructurada.';
COMMENT ON COLUMN mailing.ai_runs.input_hash IS 'sha256 del contenido enviado al proveedor, para poder auditar sin guardar el contenido real (que puede incluir texto de correos).';
