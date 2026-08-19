-- =============================================================================
-- Mailing AI - Indices trigram (pg_trgm) sobre from_address/from_name para
-- acelerar la busqueda de la libreta de direcciones (autocompletar Para/CC
-- al enviar un correo, ver messages_repository.search_contacts).
--
-- Misma logica que 20260814_0001_mailing_messages_trgm_indexes.sql (subject/
-- body_content): ILIKE '%texto%' con comodin al inicio nunca puede usar un
-- indice btree normal. from_address/from_name son columnas chicas asi que el
-- impacto es menor que en subject/body_content, pero esto se llama en cada
-- tecla que el usuario escribe en el autocompletar -- vale la pena.
--
-- to_addresses/cc_addresses (jsonb) quedan sin indice a proposito: son
-- arrays chicos por mensaje, el unnest para buscar ahi es barato comparado
-- con escanear from_address/from_name de toda la tabla sin indice.
--
-- CREATE INDEX CONCURRENTLY (no dentro de una transaccion explicita) para no
-- bloquear lecturas/escrituras de mailing.messages mientras se construye.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_from_address_trgm
  ON mailing.messages USING gin (from_address gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_from_name_trgm
  ON mailing.messages USING gin (from_name gin_trgm_ops);

COMMENT ON INDEX mailing.idx_messages_from_address_trgm IS 'Acelera ILIKE %texto% sobre from_address (messages_repository.search_contacts, libreta de direcciones) -- sin este indice, Postgres escanea la tabla entera.';
COMMENT ON INDEX mailing.idx_messages_from_name_trgm IS 'Acelera ILIKE %texto% sobre from_name (messages_repository.search_contacts, libreta de direcciones).';
