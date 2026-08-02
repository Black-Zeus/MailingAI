-- =============================================================================
-- Mailing AI - Estado 'running' para mailing.ai_runs.
--
-- El analisis de IA de un expediente puntual (POST /api/ai/cases/{id}/analyze)
-- pasa a ser asincrono: la fila se inserta con status='running' ANTES de
-- llamar al proveedor de IA (que puede tardar bastante) y se actualiza al
-- terminar -- asi el frontend puede mostrar "Procesando con IA..." y
-- deshabilitar el boton de forma durable (sobrevive un refresh o navegar a
-- otra pantalla y volver), en vez de depender de mantener vivo el request
-- HTTP original.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.ai_runs DROP CONSTRAINT IF EXISTS ai_runs_status_check;

ALTER TABLE mailing.ai_runs
  ADD CONSTRAINT ai_runs_status_check
  CHECK (status IN ('running', 'success', 'failed', 'blocked_by_policy'));

ALTER TABLE mailing.ai_runs ALTER COLUMN duration_ms DROP NOT NULL;

COMMENT ON COLUMN mailing.ai_runs.status IS 'running mientras se espera al proveedor de IA (fila insertada antes de llamarlo, actualizada al terminar); success/failed/blocked_by_policy son estados finales.';
COMMENT ON COLUMN mailing.ai_runs.duration_ms IS 'NULL mientras status=running -- se completa recien cuando termina la llamada al proveedor.';
