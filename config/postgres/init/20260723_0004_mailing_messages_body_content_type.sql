-- =============================================================================
-- Mailing AI - Cuerpo de correo enriquecido (HTML) en vez de solo texto plano.
-- Hasta ahora el fetch de Graph pedia el body con
-- Prefer: outlook.body-content-type="text", perdiendo el formato original.
-- De ahora en adelante n8n pide "html" y guarda el tipo real que devolvio
-- Graph en body_content_type, para que el frontend sepa si debe renderizar
-- el cuerpo como HTML (dentro de un iframe sandboxed) o como texto plano.
-- Los mensajes ya indexados quedan con 'text' (su valor real hasta ahora) --
-- no se puede reconstruir el HTML original sin volver a traerlos de Graph.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.messages
  ADD COLUMN IF NOT EXISTS body_content_type text NOT NULL DEFAULT 'text';

COMMENT ON COLUMN mailing.messages.body_content_type IS 'Formato real de body_content devuelto por Graph: "text" o "html". Los mensajes indexados antes de este cambio quedan en "text" (su formato real de entonces).';
