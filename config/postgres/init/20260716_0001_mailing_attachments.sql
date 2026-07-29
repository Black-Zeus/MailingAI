-- =============================================================================
-- Mailing AI - Trazabilidad de adjuntos (CR)
-- Adjuntos (PDF/Word) de correos enviados que mencionan "CR", para poder
-- rastrear que documento (por su nombre de archivo con formato YYYYMMDD) se
-- envio en que correo y cuando.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.message_attachments (
  attachment_row_id bigserial PRIMARY KEY,
  message_id text NOT NULL REFERENCES mailing.messages(message_id) ON DELETE CASCADE,
  attachment_id text NOT NULL,
  run_id bigint REFERENCES mailing.fetch_runs(run_id) ON DELETE SET NULL,
  file_name text NOT NULL,
  extension text,
  content_type text,
  size_bytes bigint,
  file_date date,
  matches_naming_convention boolean NOT NULL DEFAULT false,
  raw_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_message_attachments UNIQUE (message_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_file_date
  ON mailing.message_attachments (file_date);

CREATE INDEX IF NOT EXISTS idx_message_attachments_extension
  ON mailing.message_attachments (extension);

CREATE OR REPLACE VIEW mailing.v_cr_attachment_traceability AS
SELECT
  m.message_id,
  m.subject,
  m.from_address,
  m.to_addresses,
  m.sent_datetime,
  m.conversation_id,
  a.file_name,
  a.extension,
  a.file_date,
  a.matches_naming_convention,
  a.size_bytes
FROM mailing.message_attachments a
JOIN mailing.messages m ON m.message_id = a.message_id
ORDER BY m.sent_datetime DESC, a.file_name;

COMMENT ON TABLE mailing.message_attachments IS 'Adjuntos (PDF/Word) de correos enviados que mencionan CR, para trazabilidad. file_date se extrae del nombre del archivo cuando sigue el patron YYYYMMDD.';
COMMENT ON VIEW mailing.v_cr_attachment_traceability IS 'Vista de trazabilidad: cada adjunto PDF/Word encontrado, junto con los datos del correo que lo envio.';
