-- =============================================================================
-- Mailing AI - Crear expedientes en lote: buscar tambien en el buzon real.
-- Hasta ahora "Crear en lote" solo correlacionaba contra mailing.messages ya
-- indexado -- si el codigo/CR no se habia traido antes con un trabajo de
-- busqueda, el expediente quedaba vacio aunque el correo existiera en el
-- buzon real. Estas columnas guardan la configuracion de busqueda en vivo
-- (opcional) que case_batch_service usa para disparar un fetch_message_series
-- por cada palabra clave antes de correlacionar, igual que si el usuario
-- hubiera corrido el trabajo a mano primero.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.case_batch_runs
  ADD COLUMN IF NOT EXISTS search_mailbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mailbox_account_id bigint REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date_from date,
  ADD COLUMN IF NOT EXISTS date_to date;

COMMENT ON COLUMN mailing.case_batch_runs.search_mailbox IS 'Si true, cada palabra clave del lote se busca primero en el buzon real (Graph) via un trabajo fetch_message_series, no solo en lo ya indexado.';
