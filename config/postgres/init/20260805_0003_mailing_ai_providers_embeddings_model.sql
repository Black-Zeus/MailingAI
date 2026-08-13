-- =============================================================================
-- Mailing AI - nombre del modelo de embeddings, separado del modelo de chat.
--
-- "model" ya significa "modelo de chat" en toda la app (qwen2.5:14b,
-- gpt-4o-mini, etc.). Como un mismo proveedor puede tener el rol de chat y
-- el de embeddings a la vez (ver migracion 20260805_0002), hace falta un
-- campo aparte para el modelo de embeddings de ese proveedor -- si no,
-- "model" tendria que significar dos cosas distintas en la misma fila.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.ai_providers ADD COLUMN IF NOT EXISTS embeddings_model text NOT NULL DEFAULT 'bge-m3';

COMMENT ON COLUMN mailing.ai_providers.embeddings_model IS 'Modelo de embeddings de este proveedor (solo se usa si is_embeddings_active=true) -- independiente de "model", que es el modelo de chat. Un mismo proveedor puede servir un modelo de chat y uno de embeddings distintos.';
