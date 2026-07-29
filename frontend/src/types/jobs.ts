export type JobType =
  | 'fetch_sent_items'
  | 'fetch_message_series'
  | 'fetch_related_thread'
  | 'fetch_cr_attachments'
  | 'generate_activity_charts'
  | 'discover_mail_folders'
  | 'search_attachments'

export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export interface JobParameters {
  date_from?: string
  date_to?: string
  folder?: string
  from_address?: string
  subject_contains?: string
  conversation_id?: string
  cr_keyword?: string
  chart_type?: 'timeline' | 'histogram'
  top?: number
  folder_ids?: string[]
  pattern?: string
  pattern_is_regex?: boolean
  [key: string]: string | number | boolean | string[] | undefined
}

export interface JobCreatedResponse {
  job_id: string
  status: JobStatus
  created_at: string
}

export interface JobRead {
  job_id: string
  job_type: JobType
  status: JobStatus
  current_stage: string | null
  parameters: JobParameters
  result_count: number | null
  processed_items: number
  total_items: number | null
  progress_percentage: number | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
  error_code: string | null
  error_message: string | null
  retry_count: number
  retry_of_job_id: string | null
  fetch_run_id: number | null
  chart_id: number | null
}

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  fetch_sent_items: 'Consultar Elementos enviados',
  fetch_message_series: 'Buscar serie de mensajes',
  fetch_related_thread: 'Recuperar conversación',
  fetch_cr_attachments: 'Buscar adjuntos CR',
  generate_activity_charts: 'Generar gráficos de actividad',
  discover_mail_folders: 'Descubrir carpetas del buzón',
  search_attachments: 'Buscar adjuntos por carpeta y patrón',
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'En cola',
  running: 'Ejecutando',
  success: 'Completado',
  failed: 'Falló',
  cancelled: 'Cancelado',
}
