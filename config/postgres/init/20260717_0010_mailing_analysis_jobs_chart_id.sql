-- =============================================================================
-- Mailing AI - Vincula cada job de tipo generate_activity_charts con el
-- grafico que genero, para poder mostrarlo en "Ver resultados".
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.analysis_jobs
  ADD COLUMN IF NOT EXISTS chart_id bigint REFERENCES mailing.chart_runs(chart_id) ON DELETE SET NULL;

COMMENT ON COLUMN mailing.analysis_jobs.chart_id IS 'Grafico generado por este job (solo job_type=generate_activity_charts). Nulo para el resto de los tipos y para jobs de charts ejecutados antes de esta columna.';
