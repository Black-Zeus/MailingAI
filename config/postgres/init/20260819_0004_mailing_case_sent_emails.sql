-- =============================================================================
-- Mailing AI - Registro de correos enviados desde un expediente (boton
-- "Enviar correo" / "Generar reporte" -> Enviar).
--
-- Hasta ahora send_case_email (case_export.py) armaba el correo y lo mandaba
-- via n8n/Graph sin dejar ningun rastro: ni en mailing.case_audit_log, ni en
-- la linea de tiempo, y el contenido real enviado (destinatarios, asunto,
-- cuerpo) no quedaba guardado en ningun lado -- una vez enviado, no habia
-- forma de volver a verlo desde la app. Esta tabla guarda una copia completa
-- de cada envio exitoso para poder recuperarlo despues.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.case_sent_emails (
  sent_email_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  sent_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  mailbox_account_id bigint REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE SET NULL,
  to_addresses jsonb NOT NULL,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  body_html text NOT NULL,
  attached_case_pdf boolean NOT NULL DEFAULT false,
  attachment_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_sent_emails_case
  ON mailing.case_sent_emails (case_id, sent_at);

COMMENT ON TABLE mailing.case_sent_emails IS 'Copia completa de cada correo enviado con exito desde un expediente (send_case_email) -- destinatarios, asunto y cuerpo tal como se mandaron, para poder recuperarlos despues. Inmutable: nunca se edita ni se borra un envio ya registrado.';
