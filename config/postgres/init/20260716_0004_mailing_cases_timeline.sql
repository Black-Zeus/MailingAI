-- =============================================================================
-- Mailing AI - Correlacion de casos y linea de tiempo (Fase 5)
-- Expedientes (casos) armados a partir de una semilla (conversation_id, un
-- codigo CR, o un mensaje puntual), los mensajes correlacionados con su nivel
-- de confianza y origen de la correlacion, y la linea de tiempo resultante
-- (distinguiendo hecho observado / resultado por regla / inferencia de IA /
-- validacion manual, tal como pide master.md seccion 7).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.cases (
  case_id bigserial PRIMARY KEY,
  case_type text NOT NULL DEFAULT 'custom' CHECK (case_type IN ('conversation', 'cr', 'custom')),
  external_code text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  confidence real,
  primary_message_id text REFERENCES mailing.messages(message_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_external_code
  ON mailing.cases (external_code);

CREATE TABLE IF NOT EXISTS mailing.case_messages (
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES mailing.messages(message_id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'related' CHECK (relationship_type IN ('primary', 'related')),
  confidence real NOT NULL,
  correlation_source text NOT NULL CHECK (correlation_source IN ('conversation_id', 'cr_keyword', 'heuristic', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, message_id)
);

CREATE TABLE IF NOT EXISTS mailing.timeline_events (
  event_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  occurred_at timestamptz,
  actor text,
  action_type text NOT NULL,
  description text,
  source_message_id text REFERENCES mailing.messages(message_id) ON DELETE SET NULL,
  source_attachment_id bigint REFERENCES mailing.message_attachments(attachment_row_id) ON DELETE SET NULL,
  determination_type text NOT NULL DEFAULT 'hecho_observado' CHECK (determination_type IN (
    'hecho_observado', 'regla', 'inferencia_ia', 'validacion_manual'
  )),
  confidence real,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_events_case
  ON mailing.timeline_events (case_id, occurred_at);

CREATE OR REPLACE VIEW mailing.v_case_summary AS
SELECT
  c.case_id,
  c.case_type,
  c.external_code,
  c.title,
  c.status,
  c.confidence,
  count(DISTINCT cm.message_id) AS message_count,
  min(m.sent_datetime) AS first_message_at,
  max(m.sent_datetime) AS last_message_at
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence;

COMMENT ON TABLE mailing.cases IS 'Expedientes armados por correlacion a partir de una semilla (conversation_id, codigo CR o mensaje puntual).';
COMMENT ON TABLE mailing.case_messages IS 'Mensajes correlacionados a un caso, con nivel de confianza y origen de la correlacion (regla exacta o heuristica).';
COMMENT ON TABLE mailing.timeline_events IS 'Linea de tiempo por caso. determination_type distingue hecho observado / resultado por regla / inferencia de IA (Fase 6) / validacion manual -- nunca presentar una inferencia como hecho comprobado.';
