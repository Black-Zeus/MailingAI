-- =============================================================================
-- Mailing AI - Adjuntos que Graph confirma pero no matchean el patron de
-- busqueda (workflow 09) quedaban sin guardar, indistinguibles de un adjunto
-- que nunca se llego a mirar ("Adjunto no trazado" en la UI mezclaba ambos
-- casos). Se agrega una columna para poder guardarlos igual y distinguirlos.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.message_attachments
  ADD COLUMN IF NOT EXISTS matches_search_pattern boolean;

COMMENT ON COLUMN mailing.message_attachments.matches_search_pattern IS 'NULL si el workflow que lo trajo no tiene concepto de patron de busqueda (ej. 05, 06). true/false si vino de una busqueda con patron (workflow 09): indica si ese adjunto puntual matcheo el ultimo patron usado, aunque igual se guarda para que quede trazado.';
