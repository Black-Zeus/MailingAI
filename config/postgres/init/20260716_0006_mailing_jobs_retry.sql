-- =============================================================================
-- Mailing AI - Reintento controlado de jobs (Fase 3, item pendiente)
-- Un reintento crea un job NUEVO (no muta el original), enlazado via
-- retry_of_job_id, con retry_count incrementado respecto del original.
-- Los jobs son registros historicos inmutables una vez creados; un reintento
-- es una nueva corrida, no una edicion de la corrida fallida.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.analysis_jobs
  ADD COLUMN IF NOT EXISTS retry_of_job_id uuid REFERENCES mailing.analysis_jobs(job_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_retry_of
  ON mailing.analysis_jobs (retry_of_job_id);

COMMENT ON COLUMN mailing.analysis_jobs.retry_of_job_id IS 'Si este job es un reintento (POST /api/jobs/{id}/retry), apunta al job original que fallo. NULL para jobs creados directamente.';
