export type MailboxProvider = 'microsoft'

export interface MailboxAccountRead {
  mailbox_account_id: number
  label: string
  email_address: string | null
  provider: MailboxProvider
  enabled: boolean
  token_expires_at: string | null
  created_at: string
  updated_at: string
  owner_user_id: number | null
  is_notification_sender: boolean
}

export const MAILBOX_PROVIDER_LABELS: Record<MailboxProvider, string> = {
  microsoft: 'Microsoft 365',
}

export interface MailboxAccessRevokeResponse {
  revoked: boolean
  cases_affected: number
}

export type MailboxSharePermission = 'read'

export interface MailboxShareRead {
  mailbox_account_id: number
  user_id: number
  email_address: string
  display_name: string | null
  permission: MailboxSharePermission
  shared_by_user_id: number | null
  created_at: string
}
