-- =============================================================================
-- Mailing AI - Marca por item si "Crear en lote" reutilizo un expediente ya
-- existente (mismo codigo externo) en vez de crear uno nuevo.
--
-- Antes create_empty_case reutilizaba en silencio un expediente con el mismo
-- external_code -- el resultado del lote mostraba "Listo" igual para un item
-- nuevo que para uno duplicado, sin forma de distinguirlos.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.case_batch_run_items
  ADD COLUMN IF NOT EXISTS reused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mailing.case_batch_run_items.reused IS 'true si este item reutilizo un expediente que ya existia (mismo codigo externo) en vez de crear uno nuevo.';
