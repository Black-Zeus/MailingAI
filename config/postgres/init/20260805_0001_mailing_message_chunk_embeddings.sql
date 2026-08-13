-- =============================================================================
-- Mailing AI - Embeddings de correos para busqueda semantica en expedientes
-- grandes (RAG hibrido para preguntas-respuesta sobre un expediente).
--
-- Contexto: ask_case_question manda el cuerpo COMPLETO de todos los correos
-- del expediente en un solo prompt. Funciona bien para expedientes chicos o
-- conversacionales (varios correos cortos), pero algunos expedientes tienen
-- pocos correos con cuerpos muy extensos (logs tecnicos, analisis, mezcla
-- espanol/ingles) que superan comodamente num_ctx incluso despues de sacar
-- el contenido citado redundante. Para esos casos, en vez de truncar en
-- silencio, se arma el contexto con los fragmentos mas relevantes por
-- similitud semantica + los correos mas recientes completos.
--
-- Requiere la extension pgvector (imagen pgvector/pgvector:pg16, ver
-- docker-compose.yml -- reemplaza a postgres:16.13-alpine, mismo volumen de
-- datos, sin migracion de por medio).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Un correo largo se trocea en varios chunks (ver embeddings_service.py) para
-- que la recuperacion sea granular -- un correo de 7000 tokens como un solo
-- vector diluye cualquier hecho puntual que haya adentro.
CREATE TABLE IF NOT EXISTS mailing.message_chunk_embeddings (
  embedding_id  bigserial PRIMARY KEY,
  case_id       bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  -- text, no bigint: mailing.messages.message_id es el id opaco de Microsoft
  -- Graph (base64-like), no un numero.
  message_id    text NOT NULL REFERENCES mailing.messages(message_id) ON DELETE CASCADE,
  chunk_index   int NOT NULL,
  -- Texto ya extraido de HTML y con el contenido citado redundante cortado
  -- (mismo pipeline que _build_case_qa_context) -- se guarda literal para no
  -- tener que re-procesar el correo al momento de responder una pregunta.
  chunk_text    text NOT NULL,
  -- Dimension del modelo bge-m3 (ollama show bge-m3 -> embedding length 1024).
  -- Si el modelo de embeddings cambia a uno con otra dimension, esta columna
  -- necesita recrearse (no hay forma de mezclar dimensiones distintas en la
  -- misma columna vector).
  embedding     vector(1024) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_message_chunk_embeddings_case
  ON mailing.message_chunk_embeddings (case_id);

CREATE INDEX IF NOT EXISTS idx_message_chunk_embeddings_vector
  ON mailing.message_chunk_embeddings
  USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE mailing.message_chunk_embeddings IS 'Fragmentos de correos con su embedding (bge-m3, 1024 dim) para busqueda semantica -- usado por ask_case_question cuando el expediente no entra completo en num_ctx. Se genera al asociar un correo a un expediente, no en cada pregunta.';
COMMENT ON COLUMN mailing.message_chunk_embeddings.chunk_text IS 'Texto ya extraido/limpiado del correo (mismo pipeline que el contexto completo) -- evita re-procesar HTML al recuperar.';
