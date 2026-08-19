-- =============================================================================
-- Mailing AI - Plantillas de correo para reportar expedientes cerrados.
--
-- Recurso de EQUIPO (no personal, no admin-only): cualquier usuario
-- autenticado crea/edita/activa/desactiva/borra cualquier plantilla -- son
-- convenciones de reporte hacia terceros (CyberSOC, clientes), no algo
-- privado de cada auditor.
--
-- subject_template/body_template usan "variables" tipo [ID_CASO] -- un
-- registro fijo de variables automaticas (ver mail_templates_service.py)
-- se completa con datos reales del expediente; cualquier otro [TEXTO] que
-- aparezca en la plantilla y no este en ese registro se trata como campo
-- manual: el frontend lo detecta solo (regex) y pide llenarlo antes de
-- generar el reporte -- asi cada plantilla define sus propios campos sin
-- tocar codigo.
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

CREATE TABLE IF NOT EXISTS mailing.mail_templates (
  template_id         bigserial PRIMARY KEY,
  name                 text NOT NULL,
  subject_template     text NOT NULL,
  -- Markdown, mismo formato que ya edita el modal "Enviar correo" de un
  -- expediente (convertido a HTML recien al generar/previsualizar, via
  -- markdown_render.py -- mismo pipeline, no uno nuevo).
  body_template        text NOT NULL,
  active                boolean NOT NULL DEFAULT true,
  -- Recurso de equipo: si se borra el usuario que la creo, la plantilla
  -- sobrevive (SET NULL, no CASCADE) -- a diferencia de mailing.case_exclusion_rules
  -- (personal, CASCADE), esta no es de nadie en particular.
  created_by_user_id   bigint REFERENCES identity.users(user_id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mailing.mail_templates IS 'Plantillas de correo (asunto+cuerpo Markdown con variables [VAR]) para reportar expedientes cerrados -- compartidas para todo el equipo. Ver mail_templates_service.render_report para la sustitucion de variables.';
