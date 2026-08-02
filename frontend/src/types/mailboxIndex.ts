export type MailboxIndexStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled'
export type MailboxIndexFolderStatus = 'pendiente' | 'indexando' | 'listo' | 'parcial' | 'error'

export interface MailboxIndexFolderRead {
  folder_run_id: number
  position: number
  folder_id: string | null
  folder_path: string | null
  status: MailboxIndexFolderStatus
  folder_total_item_count: number | null
  messages_indexed: number
  windows_processed: number
  detail: string | null
  started_at: string | null
  finished_at: string | null
}

export interface MailboxIndexRunRead {
  index_run_id: string
  mailbox_account_id: number
  status: MailboxIndexStatus
  requested_by_user_id: number | null
  total_folders: number
  processed_folders: number
  total_messages_indexed: number
  total_messages_expected: number
  current_job_id: string | null
  cancel_requested: boolean
  error_message: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
  folders: MailboxIndexFolderRead[]
}

export const MAILBOX_INDEX_STATUS_LABELS: Record<MailboxIndexStatus, string> = {
  queued: 'En cola',
  running: 'Indexando',
  success: 'Completa',
  partial: 'Parcial',
  failed: 'Falló',
  cancelled: 'Cancelada',
}

export const MAILBOX_INDEX_FOLDER_STATUS_LABELS: Record<MailboxIndexFolderStatus, string> = {
  pendiente: 'Pendiente',
  indexando: 'Indexando',
  listo: 'Lista',
  parcial: 'Parcial',
  error: 'Error',
}
