-- =============================================================================
-- Mailing AI - Log de auditoria por expediente.
--
-- Registra quien cambio que y cuando en un expediente (conclusion, estado,
-- accion pendiente, proxima revision, notas, evidencia, resumen de IA). No
-- reemplaza mailing.timeline_events (esa tabla es narrativa de caso, para el
-- PDF/linea de tiempo, con actor de texto libre y clasificacion de peso
-- evidencial) -- esta tabla es puramente de auditoria tecnica: quien (FK a
-- identity.users), cuando, que campo, valor viejo/nuevo.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.case_audit_log (
  audit_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  field_name text,
  old_value text,
  new_value text,
  description text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_audit_log_case
  ON mailing.case_audit_log (case_id, occurred_at DESC);

COMMENT ON TABLE mailing.case_audit_log IS 'Historial tecnico de cambios de un expediente (quien/cuando/que campo/valor viejo->nuevo). Separado de timeline_events (narrativa del caso para PDF/UI).';
