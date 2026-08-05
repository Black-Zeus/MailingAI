-- =============================================================================
-- Mailing AI - num_ctx configurable por proveedor Ollama.
--
-- Antes num_ctx (tamaño de contexto que Ollama reserva para la consulta)
-- estaba hardcodeado en ollama_provider.py -- cualquier ajuste necesitaba
-- rebuild + restart del backend. Se mueve a la fila del proveedor para
-- poder cambiarlo en caliente desde Configuracion > Integracion IA.
--
-- Default 8192: cubre el cuerpo completo de la mayoria de expedientes sin
-- competir por RAM con otros servicios del mismo host Ollama (ver
-- ollama_provider.py para el detalle de por que no 32768 por defecto).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.ai_providers ADD COLUMN IF NOT EXISTS num_ctx integer NOT NULL DEFAULT 8192;

COMMENT ON COLUMN mailing.ai_providers.num_ctx IS 'Tamaño de contexto (num_ctx) para proveedores Ollama -- cuantos tokens de historial/contenido puede procesar el modelo por consulta. Ignorado por proveedores openai/anthropic (manejan su propio limite). Editable desde Configuracion > Integracion IA, sin necesitar reiniciar el backend.';
