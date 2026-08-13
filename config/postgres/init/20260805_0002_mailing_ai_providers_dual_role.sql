-- =============================================================================
-- Mailing AI - separa el "activo" unico de ai_providers en dos roles
-- independientes: is_chat_active (preguntas/analisis) e is_embeddings_active
-- (busqueda semantica de expedientes grandes, ver migracion 20260805_0001).
--
-- Antes de esto no habia forma de elegir/ver desde la UI que proveedor
-- genera los embeddings -- quedaba hardcodeado en embeddings_service.py. El
-- mismo proveedor puede tener los dos roles a la vez (el caso tipico: un
-- unico Ollama propio sirve tanto el chat como bge-m3), o roles distintos
-- (ej. ChatGPT para las consultas, un Ollama propio solo para embeddings).
-- No existe un "activar" generico -- cada rol se prende/apaga por separado,
-- asi que nunca queda un proveedor activo sin ningun rol.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.ai_providers RENAME COLUMN is_active TO is_chat_active;
ALTER TABLE mailing.ai_providers ADD COLUMN IF NOT EXISTS is_embeddings_active boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS mailing.idx_ai_providers_one_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_one_chat_active
  ON mailing.ai_providers ((true))
  WHERE is_chat_active;

-- Los embeddings solo se soportan contra un Ollama propio (ver
-- embeddings_service.py) -- la app ya valida esto al activar el rol, pero el
-- indice no distingue tipo de proveedor, solo garantiza que a lo sumo uno
-- este marcado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_one_embeddings_active
  ON mailing.ai_providers ((true))
  WHERE is_embeddings_active;

-- Semilla: si ningun proveedor tiene el rol de embeddings todavia, se marca
-- el primer Ollama que haya (es donde efectivamente se bajo bge-m3 a mano)
-- para no romper la busqueda semantica que ya estaba funcionando.
UPDATE mailing.ai_providers SET is_embeddings_active = true
WHERE provider_id = (
  SELECT provider_id FROM mailing.ai_providers
  WHERE provider_type = 'ollama'
  ORDER BY is_chat_active DESC, created_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM mailing.ai_providers WHERE is_embeddings_active);

COMMENT ON COLUMN mailing.ai_providers.is_chat_active IS 'Proveedor usado para preguntas/analisis de expedientes -- a lo sumo uno en true (ver idx_ai_providers_one_chat_active).';
COMMENT ON COLUMN mailing.ai_providers.is_embeddings_active IS 'Proveedor usado para generar embeddings de busqueda semantica -- a lo sumo uno en true (ver idx_ai_providers_one_embeddings_active). Solo tiene sentido en proveedores tipo ollama, validado a nivel de aplicacion.';
