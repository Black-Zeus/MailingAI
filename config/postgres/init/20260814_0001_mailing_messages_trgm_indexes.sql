-- =============================================================================
-- Mailing AI - Indices trigram (pg_trgm) para acelerar las busquedas ILIKE
-- '%texto%' sobre mailing.messages (subject y body_content).
--
-- Contexto: find_messages_by_cr_keyword y find_heuristic_related
-- (cases_repository.py) buscan con ILIKE y comodin al inicio -- eso nunca
-- puede usar un indice btree normal, asi que Postgres escaneaba la tabla
-- entera fila por fila. Con 16k+ mensajes y ~1GB de texto en body_content
-- (hasta 6MB por correo), cada llamada tardaba varios segundos, y se llama
-- una vez POR EXPEDIENTE en la correlacion (create_case, refresh_case_
-- correlation, y el escaneo de expedientes cerrados de refresh_all_cases)
-- -- "Actualizar correlacion global" con varias decenas de expedientes
-- llegaba a tardar minutos, sin escalar si hay mas de un usuario.
--
-- pg_trgm indexa trozos de 3 caracteres (trigramas) y acelera tanto LIKE
-- como ILIKE via GIN sin cambiar el resultado de la busqueda -- mismo SQL
-- en cases_repository.py, ninguna consulta necesita reescribirse.
--
-- CREATE INDEX CONCURRENTLY (no dentro de una transaccion explicita) para
-- no bloquear lecturas/escrituras de mailing.messages mientras se construye
-- -- con ~1GB de texto el build puede tardar varios minutos.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_subject_trgm
  ON mailing.messages USING gin (subject gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_body_content_trgm
  ON mailing.messages USING gin (body_content gin_trgm_ops);

COMMENT ON INDEX mailing.idx_messages_subject_trgm IS 'Acelera ILIKE %texto% sobre subject (find_messages_by_cr_keyword, find_heuristic_related) -- sin este indice, Postgres escanea la tabla entera.';
COMMENT ON INDEX mailing.idx_messages_body_content_trgm IS 'Acelera ILIKE %texto% sobre body_content (find_messages_by_cr_keyword) -- columna con hasta 6MB por fila, la mas cara de escanear sin indice.';
