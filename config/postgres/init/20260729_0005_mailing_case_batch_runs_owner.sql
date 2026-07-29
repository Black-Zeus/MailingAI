-- =============================================================================
-- Mailing AI - Dueño de una corrida de creacion de expedientes en lote.
--
-- case_batch_runs/run_batch corren como BackgroundTask (ver
-- case_batch_service.py): el usuario que la disparo ya no esta en el
-- contexto de ningun request cuando la corrida realmente ejecuta, asi que
-- hay que persistir quien la pidio para poder asignar ese mismo dueño a
-- cada expediente que el lote crea (create_empty_case necesita un owner).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.case_batch_runs
  ADD COLUMN IF NOT EXISTS requested_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN mailing.case_batch_runs.requested_by_user_id IS 'Usuario que disparo el lote -- se usa como owner_user_id de cada expediente que crea (run_batch corre en background, sin contexto de request/sesion).';
