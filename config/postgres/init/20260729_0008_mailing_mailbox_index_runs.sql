-- =============================================================================
-- Mailing AI - Indexacion completa de buzon (desatendida, solo admin).
--
-- Orquesta jobs fetch_message_series/discover_mail_folders ya existentes,
-- uno a la vez, recorriendo todas las carpetas de un buzon desde el
-- principio de los tiempos. mailing.mailbox_index_runs es la corrida global
-- (una a la vez, ver mailbox_index_repository.get_active_run); cada fila de
-- mailing.mailbox_index_folders es el progreso de una carpeta dentro de esa
-- corrida. No reemplaza mailing.analysis_jobs: cada ventana de fechas que se
-- indexa sigue disparando un job real ahi, esto solo trackea el avance
-- agregado por carpeta para que el frontend lo pueda consultar en cualquier
-- momento, incluso despues de un refresh de pagina.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.mailbox_index_runs (
  index_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_account_id bigint NOT NULL REFERENCES identity.mailbox_accounts(mailbox_account_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'partial', 'failed', 'cancelled')),
  requested_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  total_folders integer NOT NULL DEFAULT 0,
  processed_folders integer NOT NULL DEFAULT 0,
  total_messages_indexed integer NOT NULL DEFAULT 0,
  current_job_id uuid,
  cancel_requested boolean NOT NULL DEFAULT false,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mailbox_index_runs_requested_at
  ON mailing.mailbox_index_runs (requested_at DESC);

-- A lo sumo una corrida activa (queued/running) en todo el sistema a la vez
-- -- es la palanca principal de "bajo consumo": nunca hay dos indexaciones
-- completas compitiendo por Graph/Postgres al mismo tiempo. Mismo truco de
-- indice unico parcial que mailing.ai_providers.is_active.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_index_runs_one_active
  ON mailing.mailbox_index_runs ((true))
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS mailing.mailbox_index_folders (
  folder_run_id bigserial PRIMARY KEY,
  index_run_id uuid NOT NULL REFERENCES mailing.mailbox_index_runs(index_run_id) ON DELETE CASCADE,
  position integer NOT NULL,
  folder_id text REFERENCES mailing.mail_folders(folder_id) ON DELETE SET NULL,
  folder_path text,
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'indexando', 'listo', 'parcial', 'error')),
  folder_total_item_count integer,
  messages_indexed integer NOT NULL DEFAULT 0,
  windows_processed integer NOT NULL DEFAULT 0,
  detail text,
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mailbox_index_folders_run
  ON mailing.mailbox_index_folders (index_run_id, position);

COMMENT ON TABLE mailing.mailbox_index_runs IS 'Corridas de indexacion completa de un buzon (todas las carpetas, todo el historial), disparadas solo por un admin. A lo sumo una activa a la vez en todo el sistema.';
COMMENT ON TABLE mailing.mailbox_index_folders IS 'Progreso por carpeta de una corrida de mailing.mailbox_index_runs. Una carpeta puede requerir varios jobs fetch_message_series reales (bisection de ventanas de fechas), esto solo trackea el agregado.';
COMMENT ON COLUMN mailing.mailbox_index_runs.current_job_id IS 'job_id de mailing.analysis_jobs actualmente en vuelo para esta corrida (discover_mail_folders o fetch_message_series), null entre ventanas. Se usa para poder cancelar el job real en curso.';
