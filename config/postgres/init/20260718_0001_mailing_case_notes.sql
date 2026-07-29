-- =============================================================================
-- Mailing AI - Notas del auditor como lista con fecha/hora, en vez de un
-- unico campo de texto que se sobreescribe cada vez que se guarda. Cada nota
-- queda como un registro propio e inmutable (no se editan ni se borran notas
-- ya guardadas, se agregan nuevas -- consistente con el resto del proyecto,
-- que trata todo lo relacionado a evidencia como historico, no editable).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.case_notes (
  note_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_notes_case
  ON mailing.case_notes (case_id, created_at);

-- Migra la unica nota real que existia en el campo viejo (mailing.cases.notes)
-- antes de eliminarlo, para no perder lo que el usuario ya habia guardado.
INSERT INTO mailing.case_notes (case_id, body, created_at)
SELECT case_id, notes, updated_at
FROM mailing.cases
WHERE notes IS NOT NULL AND notes != '';

-- La vista depende de la columna, hay que recrearla (DROP+CREATE, no
-- CREATE OR REPLACE -- Postgres no permite quitar columnas con REPLACE).
DROP VIEW IF EXISTS mailing.v_case_summary;

ALTER TABLE mailing.cases DROP COLUMN IF EXISTS notes;

CREATE VIEW mailing.v_case_summary AS
SELECT
  c.case_id,
  c.case_type,
  c.external_code,
  c.title,
  c.status,
  c.confidence,
  count(DISTINCT cm.message_id) AS message_count,
  min(m.sent_datetime) AS first_message_at,
  max(m.sent_datetime) AS last_message_at,
  c.outcome
FROM mailing.cases c
LEFT JOIN mailing.case_messages cm ON cm.case_id = c.case_id
LEFT JOIN mailing.messages m ON m.message_id = cm.message_id
GROUP BY c.case_id, c.case_type, c.external_code, c.title, c.status, c.confidence, c.outcome;

COMMENT ON TABLE mailing.case_notes IS 'Notas libres del auditor sobre un expediente, como lista cronologica -- nunca generadas por IA, nunca editadas/borradas, solo se agregan nuevas.';
