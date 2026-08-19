import type { AIAnalyzeResponse } from './ai'

export type SeedType = 'conversation_id' | 'cr_keyword' | 'message_id'
export type CaseType = 'conversation' | 'cr' | 'custom'
export type DeterminationType = 'hecho_observado' | 'regla' | 'inferencia_ia' | 'validacion_manual'
export type CaseOutcome =
  | 'con_hallazgos'
  | 'sin_hallazgos'
  | 'pendiente'
  | 'en_proceso'
  | 'derivado'
  | 'mas_antecedentes'
  | 'investigado_sin_compromiso'
  | 'falso_positivo'
  | 'mitigado'
  | 'sin_recepcion'

export interface CaseSummary {
  case_id: number
  case_type: string
  external_code: string | null
  title: string
  status: string
  confidence: number | null
  message_count: number
  first_message_at: string | null
  last_message_at: string | null
  outcome: CaseOutcome | null
  has_successful_ai_run: boolean
  ai_stale: boolean
  has_own_reply: boolean
  owner_user_id: number | null
  created_at: string
  pending_action: string | null
  next_review_at: string | null
  previous_owner_label: string | null
  updated_at: string
  pending_reopen_message_count: number
  closing_glosa: string | null
  alert_type: string | null
}

export type CaseSharePermission = 'read' | 'edit'

export interface CaseShareRead {
  user_id: number
  email_address: string
  display_name: string | null
  permission: CaseSharePermission
  created_at: string
}

export interface CaseNoteRead {
  note_id: number
  body: string
  body_markdown: string
  created_at: string
  created_by_user_id: number | null
  created_by_label: string | null
  updated_at: string | null
}

export interface CaseEvidenceRead {
  evidence_id: number
  glosa: string
  file_name: string
  content_type: string
  size_bytes: number
  created_at: string
}

export interface CaseSentEmailRead {
  sent_email_id: number
  to_addresses: string[]
  cc_addresses: string[]
  subject: string
  body_html: string
  attached_case_pdf: boolean
  attachment_names: string[]
  sent_at: string
  sent_by_label: string | null
}

export interface CaseAttachmentRead {
  attachment_row_id: number
  attachment_id: string
  file_name: string
  extension: string | null
  size_bytes: number | null
  matches_naming_convention: boolean
  matches_search_pattern: boolean | null
  content_sha256: string | null
}

export interface CaseMessageRead {
  message_id: string
  subject: string | null
  from_address: string | null
  to_addresses: string[]
  cc_addresses: string[]
  sent_datetime: string | null
  relationship_type: string
  confidence: number
  correlation_source: string
  has_attachments: boolean
  attachments: CaseAttachmentRead[]
  body_preview: string | null
  body_content: string | null
  body_content_type: string
  web_link: string | null
  mailbox_account_id: number | null
  mailbox_label: string | null
}

export interface TimelineEventRead {
  event_id: number
  occurred_at: string | null
  actor: string | null
  action_type: string
  description: string | null
  source_message_id: string | null
  source_attachment_id: number | null
  determination_type: DeterminationType
  confidence: number | null
}

export interface CaseDetail extends CaseSummary {
  messages: CaseMessageRead[]
  timeline: TimelineEventRead[]
  notes: CaseNoteRead[]
  evidence: CaseEvidenceRead[]
  sent_emails: CaseSentEmailRead[]
  latest_ai_run: AIAnalyzeResponse | null
  ai_summary_override: string | null
}

export interface CaseDashboardStats {
  total: number
  open_count: number
  closed_count: number
  overdue_review_count: number
  stale_ai_count: number
  no_ai_count: number
  // Clave = CaseOutcome, salvo '(sin definir)' para expedientes sin conclusion asignada.
  by_outcome: Record<string, number>
}

export interface CaseAuditLogRead {
  audit_id: number
  user_display_name: string | null
  occurred_at: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  description: string
}

export interface CaseSeedPrefill {
  title: string
  seedType: SeedType
  seedValue: string
  caseType: CaseType
}

export interface ExclusionRuleFields {
  match_subject: boolean
  match_body: boolean
  match_from: boolean
  match_to: boolean
  match_cc: boolean
  match_attachment: boolean
}

export interface ExclusionRuleRead extends ExclusionRuleFields {
  rule_id: number
  owner_user_id: number
  case_id: number | null
  pattern: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export const EXCLUSION_RULE_FIELD_LABELS: Record<keyof ExclusionRuleFields, string> = {
  match_subject: 'Asunto',
  match_body: 'Cuerpo',
  match_from: 'Remitente',
  match_to: 'Para',
  match_cc: 'Copia (CC)',
  match_attachment: 'Adjunto',
}

export type CaseBatchItemStatus = 'pendiente' | 'creando' | 'listo' | 'error'
export type CaseBatchStatus = 'queued' | 'running' | 'success' | 'failed'

export interface CaseBatchItemRead {
  item_id: number
  position: number
  keyword: string
  status: CaseBatchItemStatus
  detail: string | null
  case_id: number | null
  reused: boolean
}

export interface CaseBatchRunRead {
  batch_run_id: string
  status: CaseBatchStatus
  case_type: CaseType
  total_keywords: number
  processed_keywords: number
  error_message: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
  search_mailbox: boolean
  mailbox_account_id: number | null
  date_from: string | null
  date_to: string | null
  created_count: number
  correlated_count: number
  searched_count: number
  items: CaseBatchItemRead[]
}

export const DETERMINATION_LABELS: Record<DeterminationType, string> = {
  hecho_observado: 'Hecho observado',
  regla: 'Resultado por regla',
  inferencia_ia: 'Inferencia de IA',
  validacion_manual: 'Validación manual',
}

export const CASE_OUTCOME_LABELS: Record<CaseOutcome, string> = {
  con_hallazgos: 'Con hallazgos',
  sin_hallazgos: 'Sin hallazgos (nada que revisar)',
  pendiente: 'Pendiente de revisión',
  en_proceso: 'En proceso',
  derivado: 'Derivado a',
  mas_antecedentes: 'Se solicitan más antecedentes',
  investigado_sin_compromiso: 'Investigado — sin compromiso',
  falso_positivo: 'Falso positivo',
  mitigado: 'Mitigado / remediado',
  sin_recepcion: 'Sin recepción del correo',
}

export const CORRELATION_SOURCE_LABELS: Record<string, string> = {
  conversation_id: 'Mismo hilo',
  cr_keyword: 'Palabra clave CR',
  heuristic: 'Heurística (tema + participante)',
  manual: 'Manual',
}
