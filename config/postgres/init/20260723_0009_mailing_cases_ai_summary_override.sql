-- =============================================================================
-- Mailing AI - Anotacion de IA editable + el analisis ya no cierra solo.
-- Dos cambios de comportamiento pedidos por el auditor:
--   1. Un analisis de IA exitoso deja de cerrar el expediente automaticamente
--      (las respuestas no siempre son 100% satisfactorias y requieren
--      edicion del auditor antes de dar el caso por cerrado).
--   2. El texto del resumen de IA se puede corregir/pulir sin perder el
--      registro original -- mailing.ai_runs.output_json sigue intacto para
--      auditoria; ai_summary_override es la version que el auditor ajusto y
--      la que se muestra en la UI, la linea de tiempo y el PDF cuando existe.
--      Se limpia sola cada vez que corre un analisis nuevo (el texto crudo
--      fresco vuelve a ser la base, no queda pisado por una edicion vieja).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases
  ADD COLUMN IF NOT EXISTS ai_summary_override text;

COMMENT ON COLUMN mailing.cases.ai_summary_override IS 'Texto del resumen de IA corregido a mano por el auditor -- reemplaza al de mailing.ai_runs.output_json en la UI/PDF cuando esta definido. Se limpia automaticamente en cada nuevo analisis exitoso.';
