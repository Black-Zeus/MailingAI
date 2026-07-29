-- =============================================================================
-- Mailing AI - Cuerpo completo del mensaje (a pedido del usuario, revision de
-- un expediente). Hasta ahora solo se guardaba body_preview (recorte corto
-- de Graph, ~255 caracteres). Se pide a Graph el body completo en texto
-- plano (header "Prefer: outlook.body-content-type=text"), asi se evita
-- guardar/renderizar HTML crudo en el frontend.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.messages
  ADD COLUMN IF NOT EXISTS body_content text;

COMMENT ON COLUMN mailing.messages.body_content IS 'Cuerpo completo del mensaje en texto plano (Graph con Prefer: outlook.body-content-type=text). NULL para mensajes traidos antes de esta migracion, hasta que se vuelvan a fetchear.';
