import type { CaseOutcome } from './cases'

export interface AICaseSummary {
  summary: string
  key_participants: string[]
  suggested_priority: 'low' | 'medium' | 'high'
  suggested_next_action: string
  suggested_outcome: CaseOutcome
}

export interface AIAnalyzeResponse {
  ai_run_id: number
  status: 'running' | 'success' | 'failed' | 'blocked_by_policy'
  provider: string
  model: string
  policy: string
  result: AICaseSummary | null
  error_message: string | null
  analyzed_at: string | null
}

export type AIProviderType = 'ollama' | 'openai' | 'anthropic'
export type AIPolicy = 'local_only' | 'allow_external'

export interface AIProviderRead {
  provider_id: number
  label: string
  provider_type: AIProviderType
  base_url: string | null
  model: string
  has_api_key: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AIHealthResponse {
  policy: string
  active_provider: AIProviderRead | null
  healthy: boolean | null
}

export type AIBatchRunStatus = 'queued' | 'running' | 'success' | 'failed'

export interface AIBatchRunRead {
  batch_run_id: string
  status: AIBatchRunStatus
  total_cases: number
  processed_cases: number
  succeeded_cases: number
  failed_cases: number
  error_message: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
}

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
}

export const AI_PROVIDER_TYPE_LABELS: Record<AIProviderType, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
}

// "Local" = infraestructura propia (Ollama autohospedado, sea en este equipo
// o en un servidor de la red corporativa) -- nunca manda el contenido a un
// tercero. No tiene que ver con la ubicación de red, sino con quién es dueño
// del servidor. Debe reflejar exactamente _LOCAL_PROVIDERS del backend
// (ai_providers_service.py).
const LOCAL_PROVIDER_TYPES: ReadonlySet<AIProviderType> = new Set(['ollama'])

export function isLocalProviderType(type: AIProviderType): boolean {
  return LOCAL_PROVIDER_TYPES.has(type)
}

export const AI_POLICY_LABELS: Record<AIPolicy, string> = {
  local_only: 'Solo local (bloquea proveedores externos)',
  allow_external: 'Permitir proveedores externos',
}
