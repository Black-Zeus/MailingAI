-- =============================================================================
-- Mailing AI - Registro de proveedores de IA (Ollama en otra maquina de la
-- red, OpenAI, Claude/Anthropic), con exactamente uno activo a la vez, y la
-- politica que decide si un proveedor externo puede activarse.
--
-- Reemplaza el esquema anterior basado en variables de entorno
-- (AI_ENABLED_PROVIDERS / AI_DEFAULT_POLICY / AI_OLLAMA_*, Fase 6) por
-- configuracion editable desde la UI (Configuracion), persistida aca.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.ai_providers (
  provider_id bigserial PRIMARY KEY,
  label text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic')),
  base_url text,
  model text NOT NULL,
  api_key text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Garantiza que a lo sumo un proveedor este activo a la vez (indice unico
-- parcial sobre una expresion constante -- el truco estandar de Postgres
-- para "a lo sumo una fila con este flag en true").
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_one_active
  ON mailing.ai_providers ((true))
  WHERE is_active;

CREATE TABLE IF NOT EXISTS mailing.ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  policy text NOT NULL DEFAULT 'local_only' CHECK (policy IN ('local_only', 'allow_external')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Semilla: si la tabla esta vacia, se agrega el Ollama local que ya estaba
-- configurado por variables de entorno, como proveedor activo -- para que
-- el comportamiento existente no se rompa al aplicar esta migracion.
INSERT INTO mailing.ai_providers (label, provider_type, base_url, model, is_active)
SELECT 'Ollama (local)', 'ollama', 'http://ollama:11434', 'qwen2.5:3b', true
WHERE NOT EXISTS (SELECT 1 FROM mailing.ai_providers);

INSERT INTO mailing.ai_settings (id, policy)
SELECT true, 'local_only'
WHERE NOT EXISTS (SELECT 1 FROM mailing.ai_settings);

COMMENT ON TABLE mailing.ai_providers IS 'Proveedores de IA configurados (Ollama/OpenAI/Anthropic), exactamente uno activo a la vez. api_key nunca se devuelve por API, solo se usa internamente.';
COMMENT ON COLUMN mailing.ai_providers.base_url IS 'Para ollama: URL real del servidor (local u otro en la red). Para openai/anthropic: NULL usa el endpoint publico oficial, o una URL propia si se necesita.';
COMMENT ON TABLE mailing.ai_settings IS 'Tabla singleton (1 fila) con la politica de IA activa: local_only bloquea cualquier proveedor no-ollama antes de llamarlo.';
