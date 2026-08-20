-- =============================================================================
-- Mailing AI - Dueño de los jobs de indexacion (mailing.analysis_jobs)
--
-- Hallazgo M1 de la auditoria (docs/AUDIT_2026-08-19.md): la tabla no tenia
-- ninguna nocion de quien creo un job, asi que /api/jobs/* no filtraba por
-- usuario -- cualquier autenticado podia ver/cancelar/borrar/reintentar el
-- job de indexacion de cualquier otro. Se decidio restringir a dueño+admin
-- (mismo criterio que mailing.cases: owner_user_id NULL = huerfano, visible
-- solo para un admin -- ver cascade_revoke_user_mailbox_access).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.analysis_jobs
  ADD COLUMN IF NOT EXISTS created_by_user_id integer REFERENCES identity.users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_by_user_id
  ON mailing.analysis_jobs (created_by_user_id);

COMMENT ON COLUMN mailing.analysis_jobs.created_by_user_id IS 'Quien disparo el job desde la UI. NULL en jobs previos a esta columna -- quedan huerfanos, visibles solo para un admin, igual que un expediente sin dueño.';
