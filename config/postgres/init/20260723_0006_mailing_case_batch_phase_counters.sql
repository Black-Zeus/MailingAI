-- =============================================================================
-- Mailing AI - Contadores por fase de "Crear en lote".
-- El lote ahora corre en 3 pasadas separadas sobre TODA la lista (no una por
-- item): (1) crear todos los expedientes vacios, (2) correlacionar todos
-- contra lo ya indexado, (3) si search_mailbox esta activo, buscar cada uno
-- en el buzon real. Cada fase necesita su propio contador de avance para
-- poder mostrar "Creando expedientes (X/Y)", "Asociando mail indexado (X/Y)"
-- y "Buscando en buzones (X/Y)" por separado en la UI.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.case_batch_runs
  ADD COLUMN IF NOT EXISTS created_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correlated_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS searched_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN mailing.case_batch_runs.created_count IS 'Cuantos expedientes ya se crearon (fase 1, vacios).';
COMMENT ON COLUMN mailing.case_batch_runs.correlated_count IS 'Cuantos expedientes ya se correlacionaron contra lo ya indexado (fase 2).';
COMMENT ON COLUMN mailing.case_batch_runs.searched_count IS 'Cuantos expedientes ya terminaron su busqueda en el buzon real (fase 3, solo si search_mailbox=true).';
