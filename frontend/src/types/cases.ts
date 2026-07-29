import type { AIAnalyzeResponse } from './ai'

export type SeedType = 'conversation_id' | 'cr_keyword' | 'message_id'
export type CaseType = 'conversation' | 'cr' | 'custom'
export type DeterminationType = 'hecho_observado' | 'regla' | 'inferencia_ia' | 'validacion_manual'
export type CaseOutcome = 'con_hallazgos' | 'sin_hallazgos' | 'pendiente' | 'en_proceso' | 'derivado' | 'mas_antecedentes'

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
}

export interface CaseNoteRead {
  note_id: number
  body: string
  created_at: string
}

export interface CaseEvidenceRead {
  evidence_id: number
  glosa: string
  file_name: string
  content_type: string
  size_bytes: number
  created_at: string
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
  latest_ai_run: AIAnalyzeResponse | null
  ai_summary_override: string | null
}

export interface CaseSeedPrefill {
  title: string
  seedType: SeedType
  seedValue: string
  caseType: CaseType
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
  sin_hallazgos: 'Sin hallazgos',
  pendiente: 'Pendiente de revisión',
  en_proceso: 'En proceso',
  derivado: 'Derivado a',
  mas_antecedentes: 'Se solicitan más antecedentes',
}

export const CORRELATION_SOURCE_LABELS: Record<string, string> = {
  conversation_id: 'Mismo hilo',
  cr_keyword: 'Palabra clave CR',
  heuristic: 'Heurística (tema + participante)',
  manual: 'Manual',
}
