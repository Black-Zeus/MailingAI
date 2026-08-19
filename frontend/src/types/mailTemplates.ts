export interface MailTemplateRead {
  template_id: number
  name: string
  subject_template: string
  body_template: string
  active: boolean
  created_by_user_id: number | null
  created_at: string
  updated_at: string
}

// Espejo de _OUTCOME_LABELS / _build_auto_variables en
// backend/app/services/mail_templates_service.py -- cualquier [TOKEN] en una
// plantilla que NO esté en esta lista se trata como campo manual (ver
// CasesView.tsx, detección de campos al generar un reporte).
// Nunca ID_CASO: es el id interno correlativo de la base de datos, un
// expediente nunca debe identificarse hacia afuera por ese numero -- para
// referenciarlo en un correo se usa CODIGO (ticket/CR externo) o TITULO.
export const AUTO_VARIABLES: { name: string; description: string }[] = [
  { name: 'CODIGO', description: 'Código externo (ticket/CR) del expediente' },
  { name: 'TITULO', description: 'Título del expediente' },
  { name: 'TIPO', description: 'Tipo de expediente (conversation/cr/custom)' },
  { name: 'CONCLUSION', description: 'Conclusión de la revisión, ya con etiqueta legible' },
  { name: 'FECHA_CREACION', description: 'Fecha de creación del expediente' },
  { name: 'FECHA_CIERRE', description: 'Fecha de la última modificación (aproximada al cierre)' },
  { name: 'CANTIDAD_CORREOS', description: 'Cantidad de correos vinculados' },
  { name: 'DUENO', description: 'Nombre o correo del dueño actual del expediente' },
  { name: 'TIPO_DE_ALERTA', description: 'Tipo de alerta del expediente (campo editable en la ficha)' },
  { name: 'EVIDENCIA', description: 'Lista de las glosas de evidencia adjuntadas al expediente' },
]

export const AUTO_VARIABLE_NAMES = new Set(AUTO_VARIABLES.map((v) => v.name))
