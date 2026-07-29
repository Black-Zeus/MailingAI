export interface SystemStatus {
  backend: boolean
  postgres: boolean
  n8n: boolean
  ai: boolean
}

export interface StatsResponse {
  message_count: number
  attachment_count: number
  conversation_count: number
  case_count: number
}
