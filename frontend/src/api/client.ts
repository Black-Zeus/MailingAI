import type { JobCreatedResponse, JobParameters, JobRead, JobType } from '../types/jobs'
import type {
  AttachmentListItem,
  ConversationRead,
  MailFolderNode,
  MessageDetail,
  MessageFilters,
  MessageListItem,
} from '../types/messages'
import type {
  CaseBatchRunRead,
  CaseDetail,
  CaseEvidenceRead,
  CaseNoteRead,
  CaseSummary,
  CaseType,
  DeterminationType,
  SeedType,
} from '../types/cases'
import type {
  AIAnalyzeResponse,
  AIBatchRunRead,
  AIHealthResponse,
  AIPolicy,
  AIProviderRead,
  AIProviderType,
} from '../types/ai'
import type { StatsResponse, SystemStatus } from '../types/system'
import type {
  MailboxAccountRead,
  MailboxAccessRevokeResponse,
  MailboxDeletionImpact,
  MailboxShareRead,
  MailboxSharePermission,
} from '../types/mailboxes'
import type { CurrentUser } from '../types/auth'
import type {
  UserRead,
  UserCreatePayload,
  UserUpdatePayload,
  UserDirectoryEntry,
  UserMailboxAccessEntry,
  UserDeletionImpact,
  UserDeleteResponse,
} from '../types/users'
import type { CaseAuditLogRead, CaseDashboardStats, CaseShareRead, CaseSharePermission } from '../types/cases'
import type { NotificationRead } from '../types/notifications'
import type { MailboxIndexRunRead } from '../types/mailboxIndex'
import type { TenantConfigRead } from '../types/tenants'

declare global {
  interface Window {
    __MAILINGAI_CONFIG__?: { apiUrl?: string }
  }
}

// Orden de resolución: config en tiempo de arranque (Docker, ver
// docker-entrypoint.d/40-render-runtime-config.sh) > variable de build de Vite
// (dev local, npm run dev) > default fijo. Cambiar el backend al que apunta el
// frontend en Docker ya no requiere reconstruir la imagen -- alcanza con
// cambiar API_URL y hacer `docker compose up -d frontend`.
const runtimeApiUrl = window.__MAILINGAI_CONFIG__?.apiUrl
const API_URL = (
  (runtimeApiUrl && !runtimeApiUrl.includes('${') ? runtimeApiUrl : undefined) ??
  import.meta.env.VITE_API_URL ??
  'http://localhost:8001'
).replace(/\/$/, '')

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...init,
    })
  } catch {
    throw new ApiError(0, 'No se pudo contactar al backend. Verifica que el stack esté levantado.')
  }

  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // el backend no devolvio JSON, se usa el mensaje generico
    }
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export async function downloadAttachmentBlob(messageId: string, attachmentId: string): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(
      `${API_URL}/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
      { credentials: 'include' },
    )
  } catch {
    throw new ApiError(0, 'No se pudo contactar al backend. Verifica que el stack esté levantado.')
  }
  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // sin cuerpo JSON, se usa el mensaje generico
    }
    throw new ApiError(response.status, detail)
  }
  return response.blob()
}

export function retraceMessageAttachments(messageId: string): Promise<{ traced_count: number }> {
  return request<{ traced_count: number }>(
    `/api/messages/${encodeURIComponent(messageId)}/retrace-attachments`,
    { method: 'POST' },
  )
}

export function deleteAttachment(messageId: string, attachmentId: string): Promise<void> {
  return request<void>(
    `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: 'DELETE' },
  )
}

export async function exportCasePdfBlob(caseId: number): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/cases/${caseId}/export.pdf`, { credentials: 'include' })
  } catch {
    throw new ApiError(0, 'No se pudo contactar al backend. Verifica que el stack esté levantado.')
  }
  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // sin cuerpo JSON, se usa el mensaje generico
    }
    throw new ApiError(response.status, detail)
  }
  return response.blob()
}

export function createJob(jobType: JobType, parameters: JobParameters): Promise<JobCreatedResponse> {
  return request<JobCreatedResponse>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ job_type: jobType, parameters }),
  })
}

export function listJobs(limit = 50): Promise<JobRead[]> {
  return request<JobRead[]>(`/api/jobs?limit=${limit}`)
}

export function getJob(jobId: string): Promise<JobRead> {
  return request<JobRead>(`/api/jobs/${jobId}`)
}

export function retryJob(jobId: string): Promise<JobCreatedResponse> {
  return request<JobCreatedResponse>(`/api/jobs/${jobId}/retry`, { method: 'POST' })
}

export function cancelJob(jobId: string): Promise<JobRead> {
  return request<JobRead>(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
}

export function deleteJobs(scope: 'failed' | 'finished' | 'all-inactive'): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/api/jobs?scope=${scope}`, { method: 'DELETE' })
}

export function deleteJob(jobId: string): Promise<void> {
  return request<void>(`/api/jobs/${jobId}`, { method: 'DELETE' })
}

export function getJobMessages(jobId: string): Promise<MessageListItem[]> {
  return request<MessageListItem[]>(`/api/jobs/${jobId}/messages`)
}

export function getJobChartImageUrl(jobId: string): string {
  return `${API_URL}/api/jobs/${jobId}/chart`
}

export function getCaseChartUrl(caseId: number, chartType: 'timeline' | 'histogram'): string {
  return `${API_URL}/api/cases/${caseId}/chart?chart_type=${chartType}`
}

function buildMessageFilterParams(filters: MessageFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.folder_id) params.set('folder_id', filters.folder_id)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.from_address) params.set('from_address', filters.from_address)
  if (filters.subject_contains) params.set('subject_contains', filters.subject_contains)
  if (filters.text_search) params.set('text_search', filters.text_search)
  if (filters.text_contains) params.set('text_contains', filters.text_contains)
  if (filters.has_attachments !== undefined) params.set('has_attachments', String(filters.has_attachments))
  if (filters.attachment_pattern) params.set('attachment_pattern', filters.attachment_pattern)
  if (filters.mailbox_account_id !== undefined) params.set('mailbox_account_id', String(filters.mailbox_account_id))
  params.set('limit', String(filters.limit ?? 50))
  if (filters.offset) params.set('offset', String(filters.offset))
  return params
}

export function listMessages(filters: MessageFilters): Promise<MessageListItem[]> {
  return request<MessageListItem[]>(`/api/messages?${buildMessageFilterParams(filters).toString()}`)
}

export async function listMessagesWithTotal(
  filters: MessageFilters,
): Promise<{ items: MessageListItem[]; total: number }> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/messages?${buildMessageFilterParams(filters).toString()}`, {
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, 'No se pudo contactar al backend. Verifica que el stack esté levantado.')
  }
  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // sin cuerpo JSON, se usa el mensaje generico
    }
    throw new ApiError(response.status, detail)
  }
  const items = (await response.json()) as MessageListItem[]
  const totalHeader = response.headers.get('X-Total-Count')
  const total = totalHeader ? parseInt(totalHeader, 10) : items.length
  return { items, total }
}

export function getMessage(messageId: string): Promise<MessageDetail> {
  return request<MessageDetail>(`/api/messages/${encodeURIComponent(messageId)}`)
}

export function getConversation(conversationId: string): Promise<ConversationRead> {
  return request<ConversationRead>(`/api/conversations/${encodeURIComponent(conversationId)}`)
}

export function listMailFolders(): Promise<MailFolderNode[]> {
  return request<MailFolderNode[]>('/api/mail-folders')
}

export interface AttachmentFilters {
  file_name_contains?: string
  extension?: string
  date_from?: string
  date_to?: string
  only_hashed?: boolean
  only_linked_to_case?: boolean
  limit?: number
}

export function listAttachments(filters: AttachmentFilters): Promise<AttachmentListItem[]> {
  const params = new URLSearchParams()
  if (filters.file_name_contains) params.set('file_name_contains', filters.file_name_contains)
  if (filters.extension) params.set('extension', filters.extension)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.only_hashed !== undefined) params.set('only_hashed', String(filters.only_hashed))
  if (filters.only_linked_to_case !== undefined) {
    params.set('only_linked_to_case', String(filters.only_linked_to_case))
  }
  params.set('limit', String(filters.limit ?? 100))
  return request<AttachmentListItem[]>(`/api/attachments?${params.toString()}`)
}

export interface DeleteMessagesParams {
  scope: 'all' | 'date_range' | 'folder' | 'unlinked'
  date_from?: string
  date_to?: string
  folder_id?: string
}

export function deleteMessages(params: DeleteMessagesParams): Promise<{ deleted: number }> {
  const qs = new URLSearchParams({ scope: params.scope })
  if (params.date_from) qs.set('date_from', params.date_from)
  if (params.date_to) qs.set('date_to', params.date_to)
  if (params.folder_id) qs.set('folder_id', params.folder_id)
  return request<{ deleted: number }>(`/api/messages?${qs.toString()}`, { method: 'DELETE' })
}

export interface CaseBatchSearchOptions {
  search_mailbox?: boolean
  mailbox_account_id?: number
  date_from?: string
  date_to?: string
}

export function startCaseBatchCreate(
  keywords: string[],
  caseType: CaseType,
  searchOptions?: CaseBatchSearchOptions,
): Promise<CaseBatchRunRead> {
  return request<CaseBatchRunRead>('/api/cases/batch-create', {
    method: 'POST',
    body: JSON.stringify({ keywords, case_type: caseType, ...searchOptions }),
  })
}

export function getLatestCaseBatchCreate(): Promise<CaseBatchRunRead | null> {
  return request<CaseBatchRunRead | null>('/api/cases/batch-create/latest')
}

export function startMailboxIndex(mailboxAccountId: number): Promise<MailboxIndexRunRead> {
  return request<MailboxIndexRunRead>('/api/admin/mailbox-index', {
    method: 'POST',
    body: JSON.stringify({ mailbox_account_id: mailboxAccountId }),
  })
}

export function getLatestMailboxIndex(): Promise<MailboxIndexRunRead | null> {
  return request<MailboxIndexRunRead | null>('/api/admin/mailbox-index/latest')
}

export function getMailboxIndexRun(indexRunId: string): Promise<MailboxIndexRunRead> {
  return request<MailboxIndexRunRead>(`/api/admin/mailbox-index/${indexRunId}`)
}

export function listMailboxIndexRuns(limit = 20): Promise<MailboxIndexRunRead[]> {
  return request<MailboxIndexRunRead[]>(`/api/admin/mailbox-index?limit=${limit}`)
}

export function cancelMailboxIndex(indexRunId: string): Promise<MailboxIndexRunRead> {
  return request<MailboxIndexRunRead>(`/api/admin/mailbox-index/${indexRunId}/cancel`, { method: 'POST' })
}

export function deleteFinishedMailboxIndexRuns(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/admin/mailbox-index', { method: 'DELETE' })
}

export function triggerMailboxDeltaSync(mailboxAccountId?: number): Promise<{ accepted: boolean }> {
  const query = mailboxAccountId !== undefined ? `?mailbox_account_id=${mailboxAccountId}` : ''
  return request<{ accepted: boolean }>(`/api/admin/mailbox-index/delta-sync${query}`, { method: 'POST' })
}

export function createCase(
  title: string,
  seedType: SeedType,
  seedValue: string,
  caseType: CaseType,
): Promise<CaseDetail> {
  return request<CaseDetail>('/api/cases', {
    method: 'POST',
    body: JSON.stringify({ title, seed_type: seedType, seed_value: seedValue, case_type: caseType }),
  })
}

export function mergeCases(caseIds: number[], title: string): Promise<CaseDetail> {
  return request<CaseDetail>('/api/cases/merge', {
    method: 'POST',
    body: JSON.stringify({ case_ids: caseIds, title }),
  })
}

export function listCases(): Promise<CaseSummary[]> {
  return request<CaseSummary[]>('/api/cases')
}

export function getCase(caseId: number): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}`)
}

export function deleteCases(scope: 'all' | 'open' | 'closed'): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/api/cases?scope=${scope}`, { method: 'DELETE' })
}

export interface CaseBulkRefreshResponse {
  cases_checked: number
  cases_with_new_messages: number
  new_messages_found: number
  errors: number
}

export function refreshOpenCases(): Promise<CaseBulkRefreshResponse> {
  return request<CaseBulkRefreshResponse>('/api/cases/refresh-open', { method: 'POST' })
}

export function refreshCase(caseId: number): Promise<{ case: CaseDetail; new_messages_found: number }> {
  return request<{ case: CaseDetail; new_messages_found: number }>(`/api/cases/${caseId}/refresh`, {
    method: 'POST',
  })
}

export function deleteCase(caseId: number): Promise<void> {
  return request<void>(`/api/cases/${caseId}`, { method: 'DELETE' })
}

export function updateCase(
  caseId: number,
  payload: {
    outcome?: string | null
    status?: 'open' | 'closed'
    pending_action?: string | null
    next_review_at?: string | null
    expected_updated_at?: string
  },
): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function addCaseNote(caseId: number, body: string): Promise<CaseNoteRead> {
  return request<CaseNoteRead>(`/api/cases/${caseId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export async function addCaseEvidence(caseId: number, glosa: string, file: File): Promise<CaseEvidenceRead> {
  const formData = new FormData()
  formData.set('glosa', glosa)
  formData.set('file', file)
  let response: Response
  try {
    // Sin header Content-Type a mano: el navegador arma el boundary del
    // multipart solo si no se lo pisamos (a diferencia de request(), que
    // siempre manda application/json).
    response = await fetch(`${API_URL}/api/cases/${caseId}/evidence`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, 'No se pudo contactar al backend. Verifica que el stack esté levantado.')
  }
  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // sin cuerpo JSON, se usa el mensaje generico
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as CaseEvidenceRead
}

export function getCaseEvidenceUrl(caseId: number, evidenceId: number): string {
  return `${API_URL}/api/cases/${caseId}/evidence/${evidenceId}/content`
}

export function addCaseMessage(caseId: number, messageId: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId }),
  })
}

export function removeCaseMessage(caseId: number, messageId: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}/messages/remove`, {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId }),
  })
}

export function startAIBatchAnalyze(): Promise<AIBatchRunRead> {
  return request<AIBatchRunRead>('/api/ai/batch-analyze', { method: 'POST' })
}

export function getLatestAIBatchAnalyze(): Promise<AIBatchRunRead | null> {
  return request<AIBatchRunRead | null>('/api/ai/batch-analyze/latest')
}

export function getAIHealth(): Promise<AIHealthResponse> {
  return request<AIHealthResponse>('/api/ai/health')
}

export function analyzeCaseWithAI(caseId: number): Promise<AIAnalyzeResponse> {
  return request<AIAnalyzeResponse>(`/api/ai/cases/${caseId}/analyze`, { method: 'POST' })
}

export interface AskCaseQuestionResponse {
  answer: string
  provider: string
  model: string
}

export function askCaseQuestion(caseId: number, question: string): Promise<AskCaseQuestionResponse> {
  return request<AskCaseQuestionResponse>(`/api/ai/cases/${caseId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

export function updateAiSummary(
  caseId: number,
  summary: string,
  expectedUpdatedAt?: string,
): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}/ai-summary`, {
    method: 'PATCH',
    body: JSON.stringify({ summary, expected_updated_at: expectedUpdatedAt }),
  })
}

export function getCaseAuditLog(caseId: number): Promise<CaseAuditLogRead[]> {
  return request<CaseAuditLogRead[]>(`/api/cases/${caseId}/audit-log`)
}

export function getDashboardStats(): Promise<CaseDashboardStats> {
  return request<CaseDashboardStats>('/api/cases/dashboard/stats')
}

export function getCasesByOutcome(outcome: string): Promise<CaseSummary[]> {
  return request<CaseSummary[]>(`/api/cases/dashboard/by-outcome?outcome=${encodeURIComponent(outcome)}`)
}

export function renderMarkdownPreview(text: string): Promise<{ html: string }> {
  return request<{ html: string }>('/api/cases/render-markdown', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export interface SendCaseEmailParams {
  to: string
  cc: string
  subject: string
  body: string
  mailboxAccountId: number
  attachCasePdf: boolean
  attachments: File[]
}

export async function sendCaseEmail(caseId: number, params: SendCaseEmailParams): Promise<{ sent: boolean }> {
  const formData = new FormData()
  formData.set('to', params.to)
  formData.set('cc', params.cc)
  formData.set('subject', params.subject)
  formData.set('body', params.body)
  formData.set('mailbox_account_id', String(params.mailboxAccountId))
  formData.set('attach_case_pdf', String(params.attachCasePdf))
  for (const file of params.attachments) {
    formData.append('attachments', file)
  }
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/cases/${caseId}/send-email`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, 'No se pudo contactar al backend. Verifica que el stack esté levantado.')
  }
  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // sin cuerpo JSON, se usa el mensaje generico
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as { sent: boolean }
}

export function listAIProviders(): Promise<AIProviderRead[]> {
  return request<AIProviderRead[]>('/api/ai/providers')
}

export interface AIProviderPayload {
  label: string
  provider_type: AIProviderType
  base_url?: string | null
  model: string
  num_ctx: number
  api_key?: string | null
}

export function createAIProvider(payload: AIProviderPayload): Promise<AIProviderRead> {
  return request<AIProviderRead>('/api/ai/providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateAIProvider(providerId: number, payload: AIProviderPayload): Promise<AIProviderRead> {
  return request<AIProviderRead>(`/api/ai/providers/${providerId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteAIProvider(providerId: number): Promise<void> {
  return request<void>(`/api/ai/providers/${providerId}`, { method: 'DELETE' })
}

export function activateAIProvider(providerId: number): Promise<AIProviderRead> {
  return request<AIProviderRead>(`/api/ai/providers/${providerId}/activate`, { method: 'POST' })
}

export function testAIProvider(providerId: number): Promise<{ healthy: boolean }> {
  return request<{ healthy: boolean }>(`/api/ai/providers/${providerId}/test`, { method: 'POST' })
}

export interface AIProviderModelsQuery {
  provider_type: AIProviderType
  base_url?: string | null
  api_key?: string | null
  provider_id?: number | null
}

export function listAIProviderModels(query: AIProviderModelsQuery): Promise<{ models: string[] }> {
  return request<{ models: string[] }>('/api/ai/providers/models', {
    method: 'POST',
    body: JSON.stringify(query),
  })
}

export function getAIPolicy(): Promise<{ policy: AIPolicy }> {
  return request<{ policy: AIPolicy }>('/api/ai/policy')
}

export function updateAIPolicy(policy: AIPolicy): Promise<{ policy: AIPolicy }> {
  return request<{ policy: AIPolicy }>('/api/ai/policy', {
    method: 'PUT',
    body: JSON.stringify({ policy }),
  })
}

export function getSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/api/system/status')
}

export function getStats(): Promise<StatsResponse> {
  return request<StatsResponse>('/api/system/stats')
}

export function updateTimelineEvent(
  eventId: number,
  determinationType: DeterminationType,
): Promise<void> {
  return request<void>(`/api/timeline-events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify({ determination_type: determinationType }),
  })
}

export function listMailboxes(): Promise<MailboxAccountRead[]> {
  return request<MailboxAccountRead[]>('/api/mailboxes')
}

export function getMailboxConnectUrl(label: string, tenantConfigId: number): Promise<{ url: string }> {
  return request<{ url: string }>(
    `/api/mailboxes/connect-url?label=${encodeURIComponent(label)}&tenant_config_id=${tenantConfigId}`,
  )
}

export function listTenantConfigs(): Promise<TenantConfigRead[]> {
  return request<TenantConfigRead[]>('/api/admin/tenants')
}

export interface TenantConfigPayload {
  label: string
  ms_tenant_id: string
  ms_client_id: string
  ms_client_secret?: string | null
  is_active: boolean
}

export function createTenantConfig(payload: TenantConfigPayload): Promise<TenantConfigRead> {
  return request<TenantConfigRead>('/api/admin/tenants', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTenantConfig(tenantConfigId: number, payload: TenantConfigPayload): Promise<TenantConfigRead> {
  return request<TenantConfigRead>(`/api/admin/tenants/${tenantConfigId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteTenantConfig(tenantConfigId: number): Promise<void> {
  return request<void>(`/api/admin/tenants/${tenantConfigId}`, { method: 'DELETE' })
}

export function updateMailbox(
  mailboxAccountId: number,
  payload: { label?: string | null; enabled?: boolean | null },
): Promise<MailboxAccountRead> {
  return request<MailboxAccountRead>(`/api/mailboxes/${mailboxAccountId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function assignMailboxTenant(mailboxAccountId: number, tenantConfigId: number): Promise<MailboxAccountRead> {
  return request<MailboxAccountRead>(`/api/mailboxes/${mailboxAccountId}/tenant`, {
    method: 'PATCH',
    body: JSON.stringify({ tenant_config_id: tenantConfigId }),
  })
}

export function getMailboxDeletionImpact(mailboxAccountId: number): Promise<MailboxDeletionImpact> {
  return request<MailboxDeletionImpact>(`/api/mailboxes/${mailboxAccountId}/deletion-impact`)
}

export function deleteMailbox(mailboxAccountId: number): Promise<MailboxDeletionImpact> {
  return request<MailboxDeletionImpact>(`/api/mailboxes/${mailboxAccountId}`, { method: 'DELETE' })
}

export function testMailbox(mailboxAccountId: number): Promise<{ email_address: string | null; display_name: string | null }> {
  return request(`/api/mailboxes/${mailboxAccountId}/test`, { method: 'POST' })
}

export function getNotificationSender(): Promise<MailboxAccountRead | null> {
  return request<MailboxAccountRead | null>('/api/mailboxes/notification-sender')
}

export function setNotificationSender(mailboxAccountId: number | null): Promise<MailboxAccountRead | null> {
  return request<MailboxAccountRead | null>('/api/mailboxes/notification-sender', {
    method: 'PATCH',
    body: JSON.stringify({ mailbox_account_id: mailboxAccountId }),
  })
}

export function testNotificationSender(): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>('/api/mailboxes/notification-sender/test', { method: 'POST' })
}

export function claimMailbox(mailboxAccountId: number): Promise<MailboxAccountRead> {
  return request<MailboxAccountRead>(`/api/mailboxes/${mailboxAccountId}/claim`, { method: 'POST' })
}

export function listMailboxShares(mailboxAccountId: number): Promise<MailboxShareRead[]> {
  return request<MailboxShareRead[]>(`/api/mailboxes/${mailboxAccountId}/shares`)
}

export function shareMailbox(
  mailboxAccountId: number,
  userId: number,
  permission: MailboxSharePermission = 'read',
): Promise<MailboxShareRead> {
  return request<MailboxShareRead>(`/api/mailboxes/${mailboxAccountId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, permission }),
  })
}

export function revokeMailboxShare(mailboxAccountId: number, userId: number): Promise<MailboxAccessRevokeResponse> {
  return request<MailboxAccessRevokeResponse>(`/api/mailboxes/${mailboxAccountId}/shares/${userId}`, {
    method: 'DELETE',
  })
}

export function clearMailboxOwner(mailboxAccountId: number): Promise<MailboxAccessRevokeResponse> {
  return request<MailboxAccessRevokeResponse>(`/api/mailboxes/${mailboxAccountId}/owner`, { method: 'DELETE' })
}

// --- Autenticacion / sesion ---

export function login(): void {
  window.location.href = `${API_URL}/api/auth/login`
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' })
}

export function getCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>('/api/auth/me')
}

export function loginLocal(username: string, password: string): Promise<CurrentUser> {
  return request<CurrentUser>('/api/auth/local-login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request<void>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

export function listUserDirectory(): Promise<UserDirectoryEntry[]> {
  return request<UserDirectoryEntry[]>('/api/users')
}

// --- Administracion de usuarios (solo admin) ---

export function listUsers(): Promise<UserRead[]> {
  return request<UserRead[]>('/api/admin/users')
}

export function createUser(payload: UserCreatePayload): Promise<UserRead> {
  return request<UserRead>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateUser(userId: number, payload: UserUpdatePayload): Promise<UserRead> {
  return request<UserRead>(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function listUserMailboxes(userId: number): Promise<UserMailboxAccessEntry[]> {
  return request<UserMailboxAccessEntry[]>(`/api/admin/users/${userId}/mailboxes`)
}

export function resetUserPassword(userId: number, newPassword: string): Promise<UserRead> {
  return request<UserRead>(`/api/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export function getUserDeletionImpact(userId: number): Promise<UserDeletionImpact> {
  return request<UserDeletionImpact>(`/api/admin/users/${userId}/deletion-impact`)
}

export function deleteUser(userId: number): Promise<UserDeleteResponse> {
  return request<UserDeleteResponse>(`/api/admin/users/${userId}`, { method: 'DELETE' })
}

export function reassignCaseOwner(caseId: number, newOwnerUserId: number): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}/owner`, {
    method: 'PATCH',
    body: JSON.stringify({ new_owner_user_id: newOwnerUserId }),
  })
}

// --- Notificaciones ---

export function listNotifications(): Promise<NotificationRead[]> {
  return request<NotificationRead[]>('/api/notifications')
}

export function getUnreadNotificationCount(): Promise<{ unread: number }> {
  return request<{ unread: number }>('/api/notifications/unread-count')
}

export function markNotificationRead(notificationId: number): Promise<void> {
  return request<void>(`/api/notifications/${notificationId}/read`, { method: 'POST' })
}

export function markAllNotificationsRead(): Promise<void> {
  return request<void>('/api/notifications/read-all', { method: 'POST' })
}

export function clearAllNotifications(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/notifications', { method: 'DELETE' })
}

// --- Comparticion de expedientes ---

export function listCaseShares(caseId: number): Promise<CaseShareRead[]> {
  return request<CaseShareRead[]>(`/api/cases/${caseId}/shares`)
}

export function shareCase(
  caseId: number,
  userId: number,
  permission: CaseSharePermission = 'read',
): Promise<CaseShareRead> {
  return request<CaseShareRead>(`/api/cases/${caseId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, permission }),
  })
}

export function revokeCaseShare(caseId: number, userId: number): Promise<void> {
  return request<void>(`/api/cases/${caseId}/shares/${userId}`, { method: 'DELETE' })
}
