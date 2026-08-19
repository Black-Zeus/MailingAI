-- =============================================================================
-- Mailing AI - Frases predefinidas para "Acciones pendientes" del expediente.
--
-- Recurso de equipo (como mailing.mail_templates): cualquier usuario ve todas
-- las frases, cualquiera puede agregar una nueva -- pensado como un helper
-- de insercion rapida para redacciones que se repiten seguido (ej. "Derivado,
-- no se mantiene gestion en Mesa de Ayuda...").
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.pending_action_presets (
  preset_id bigserial PRIMARY KEY,
  text text NOT NULL,
  created_by_user_id bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mailing.pending_action_presets IS 'Frases predefinidas reutilizables para el campo "Acciones pendientes" de un expediente -- recurso de equipo, cualquier usuario puede agregar/borrar.';

INSERT INTO mailing.pending_action_presets (text)
VALUES ('Derivado, no se mantiene gestión en Mesa de Ayuda o equipo Tecnocomp, se traspasa responsabilidad y seguimiento.');
