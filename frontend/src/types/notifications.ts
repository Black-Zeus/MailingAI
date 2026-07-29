export type NotificationKind = 'case_shared' | 'mailbox_shared'

export interface NotificationRead {
  notification_id: number
  kind: NotificationKind
  message: string
  case_id: number | null
  mailbox_account_id: number | null
  read_at: string | null
  created_at: string
}
