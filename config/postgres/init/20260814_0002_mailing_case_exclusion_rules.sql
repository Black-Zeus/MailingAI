-- =============================================================================
-- Mailing AI - Reglas de exclusion de correlacion (globales por usuario, o
-- locales a un expediente puntual).
--
-- Contexto: correos "ruidosos" recurrentes (ej. un digest de comite que
-- menciona muchos codigos de ticket, o una lista de distribucion) volvian a
-- aparecer como candidato cada vez que se corria una correlacion -- la
-- exclusion puntual ya existente (bulk_remove_messages_from_case) desvincula
-- lo ya encontrado, pero no evita que el mismo correo se vuelva a sugerir en
-- el proximo refresh. Estas reglas se evaluan ANTES de vincular un mensaje
-- (cases_service._exclude_via_rules), nunca retroactivamente.
--
-- owner_user_id cumple doble rol: auditoria (quien la creo) y, para reglas
-- globales (case_id IS NULL), el alcance real -- "global" no es del sistema
-- completo, es "todos los expedientes que posee owner_user_id" (confirmado
-- con el usuario: no debe afectar expedientes de otros usuarios).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.case_exclusion_rules (
  rule_id           bigserial PRIMARY KEY,
  owner_user_id     bigint NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  -- NULL = global (todos los expedientes de owner_user_id). Con valor = local,
  -- solo aplica a ese expediente puntual.
  case_id           bigint REFERENCES mailing.cases(case_id) ON DELETE CASCADE,
  pattern           text NOT NULL,
  match_subject     boolean NOT NULL DEFAULT false,
  match_body        boolean NOT NULL DEFAULT false,
  match_from        boolean NOT NULL DEFAULT false,
  match_to          boolean NOT NULL DEFAULT false,
  match_cc          boolean NOT NULL DEFAULT false,
  match_attachment  boolean NOT NULL DEFAULT false,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_exclusion_rules_at_least_one_field CHECK (
    match_subject OR match_body OR match_from OR match_to OR match_cc OR match_attachment
  )
);

CREATE INDEX IF NOT EXISTS idx_case_exclusion_rules_case
  ON mailing.case_exclusion_rules (case_id) WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_case_exclusion_rules_owner
  ON mailing.case_exclusion_rules (owner_user_id) WHERE case_id IS NULL;

COMMENT ON TABLE mailing.case_exclusion_rules IS 'Reglas que evitan que un correo se vuelva a sugerir/vincular en la correlacion automatica de expedientes -- no retroactivas, no tocan vinculos ya existentes.';
COMMENT ON COLUMN mailing.case_exclusion_rules.owner_user_id IS 'Quien creo la regla. Para reglas globales (case_id NULL) tambien define el alcance: solo expedientes cuyo owner_user_id coincide.';
COMMENT ON COLUMN mailing.case_exclusion_rules.case_id IS 'NULL = regla global (todos los expedientes de owner_user_id). Con valor = regla local, solo ese expediente.';
