-- =============================================================================
-- Mailing AI - Marca de dueño anterior al reasignar expedientes por
-- eliminación de usuario.
--
-- Cuando un admin elimina una cuenta de usuario (distinto de solo
-- desactivarla), sus expedientes ya no pueden quedar con owner_user_id NULL
-- sin mas -- se reasignan al admin que hizo la eliminacion (para que alguien
-- siga siendo responsable), pero se guarda el nombre/email de quien era el
-- dueño real en este campo de texto plano (no FK, sobrevive a que el usuario
-- ya no exista) para que sea facil identificar y reasignar el expediente a
-- la persona correcta despues si corresponde.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

ALTER TABLE mailing.cases ADD COLUMN IF NOT EXISTS previous_owner_label text;

COMMENT ON COLUMN mailing.cases.previous_owner_label IS 'Nombre/email de quien era el dueño real antes de que un admin eliminara esa cuenta y el expediente se reasignara automaticamente. NULL en el caso normal (nunca hubo una reasignacion por eliminacion de usuario).';
