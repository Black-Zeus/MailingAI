-- =============================================================================
-- Mailing AI - Snapshot del CONTENIDO real de mailing.mail_templates y
-- mailing.pending_action_presets, al momento de escribir esto.
--
-- Ambas tablas se crean vacias (mailing.mail_templates en 20260814_0003,
-- mailing.pending_action_presets en 20260819_0005) y su contenido se fue
-- armando/editando a mano en la base ya corriendo, via UPDATE/INSERT sueltos
-- o directo desde la UI ("Mail Template", "Frases predefinidas" en Acciones
-- pendientes) -- nunca quedo en ningun archivo de migracion. Sin este
-- archivo, un stack levantado de cero (docker-entrypoint-initdb.d) queda con
-- las tablas vacias o con contenido viejo/parcial.
--
-- Idempotente a proposito (DELETE + INSERT por nombre, no solo INSERT): sirve
-- tanto para un volumen nuevo (tablas vacias) como para aplicarse a mano
-- contra la base ya en uso (deja el mismo contenido final, sin duplicar).
--
-- Este archivo se monta en /docker-entrypoint-initdb.d y corre automaticamente
-- solo cuando el volumen de PostgreSQL se crea por primera vez.
-- Si la base ya existe, aplicar a mano (ver README.md, seccion "Base de datos").
-- =============================================================================

DELETE FROM mailing.mail_templates WHERE name IN ('Reporte estándar CyberSOC', 'Notificación de Cierre de Ticket');

INSERT INTO mailing.mail_templates (name, subject_template, body_template, active) VALUES
(
  'Reporte estándar CyberSOC',
  'RE: [CODIGO] - [TIPO_DE_ALERTA]',
  $$Estimados:

Respecto del caso [CODIGO], se informa lo siguiente:

Validación: [VALIDACION]

Acción: [ACCION]

Evidencia: [EVIDENCIA]

Estado: [ESTADO]

Siguiente acción: [SIGUIENTE_ACCION]$$,
  true
),
(
  'Notificación de Cierre de Ticket',
  'RE: [CODIGO] - Cierre - [CONCLUSION]',
  $$Estimados:

[INTRODUCCION]

## 1. Datos generales del ticket

| Campo | Detalle |
|---|---|
| N° de Ticket | [CODIGO] |
| Fecha de Cierre | [FECHA_CIERRE] |
| Servicio Afectado | [SERVICIO_AFECTADO] |
| Especialista | [DUENO] |
| Prioridad / Impacto | [PRIORIDAD] |
| Equipo Responsable de Revisión | TECNOCOMP |

## 2. Origen de la solicitud

[ORIGEN_SOLICITUD]

## 3. Estado del servicio (diagnóstico inicial)

[DIAGNOSTICO_INICIAL]

## 4. Acciones realizadas

[ACCIONES_REALIZADAS]

## 5. Estado final del servicio / Derivación

**Estado Final:** [ESTADO_FINAL]

[OBSERVACIONES_DERIVACION]

Quedo atento a sus comentarios.

Saludos,$$,
  true
);

-- pending_action_presets: se reemplaza por completo (no solo se agrega) --
-- la lista se curo a mano desde la UI y ya no se parece a la seed original
-- de 20260819_0005 (esa frase inicial tambien se borro en el camino).
DELETE FROM mailing.pending_action_presets;

INSERT INTO mailing.pending_action_presets (text) VALUES
('Caso resuelto y validado. Se solicita el cierre; no se requieren acciones adicionales de seguimiento.'),
('Se solicita el cierre del caso y la ejecución de un nuevo escaneo para validar el estado actualizado del activo.'),
('Se aplicaron las acciones de remediación correspondientes. Se solicita reescaneo para validar la corrección del hallazgo.'),
('Se realizó la validación correspondiente; el comportamiento reportado se encuentra dentro de lo esperado y no requiere acción adicional.'),
('Evento validado como falso positivo. No se identifica compromiso ni se requieren acciones adicionales.'),
('Se solicita el cierre del caso debido a que los antecedentes disponibles no permiten confirmar el hallazgo ni continuar con el análisis.'),
('Se requieren antecedentes adicionales para continuar con el análisis. Caso pendiente de información.'),
('No es posible continuar con la revisión hasta identificar correctamente el activo asociado al evento.'),
('No fue posible completar la revisión debido a que el equipo se encuentra fuera de línea o sin conectividad. Pendiente de disponibilidad.'),
('Se deriva el caso al equipo responsable para su gestión, debido a que las acciones requeridas se encuentran fuera del alcance de TECNOCOMP.'),
('Se deriva el caso a proveedor externo. Se mantiene pendiente de respuesta para continuar con la gestión.'),
('Se solicita reescalar el caso a un nivel superior de atención debido a la criticidad o urgencia del hallazgo.'),
('Caso identificado como duplicado de una incidencia actualmente en gestión. Se solicita cierre y continuidad mediante el caso principal.'),
('Se aplicaron las acciones correctivas correspondientes. Caso pendiente de validación para confirmar la remediación y proceder con el cierre.');
