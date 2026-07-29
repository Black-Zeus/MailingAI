-- =============================================================================
-- Mailing AI - Buzon designado para enviar avisos por correo real.
--
-- El permiso Mail.Send ya esta consentido a nivel de la App Registration de
-- Azure (no por buzon individual, ver identity-broker/app/config.py) -- asi
-- que cualquier buzon conectado con el flujo OAuth2 existente puede enviar
-- correo. En vez de mandar el aviso de "te compartieron X" desde el buzon de
-- quien comparte (remitente inconsistente, y falla si no tiene ninguno), un
-- admin designa UN buzon como remitente de notificaciones del sistema.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE identity.mailbox_accounts
  ADD COLUMN IF NOT EXISTS is_notification_sender boolean NOT NULL DEFAULT false;

-- A lo sumo un buzon puede ser el remitente de notificaciones a la vez
-- (mismo truco que mailing.ai_providers.is_active: indice unico parcial
-- sobre una columna que solo tiene el valor 'true' entre las filas que
-- matchean el predicado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_accounts_one_notification_sender
  ON identity.mailbox_accounts (is_notification_sender)
  WHERE is_notification_sender;

COMMENT ON COLUMN identity.mailbox_accounts.is_notification_sender IS 'true en a lo sumo un buzon: el que el backend usa como remitente al enviar avisos por correo real (compartir expediente/buzon). Si ninguno lo tiene, el aviso queda solo in-app.';
