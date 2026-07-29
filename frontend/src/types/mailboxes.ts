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
}

export const MAILBOX_PROVIDER_LABELS: Record<MailboxProvider, string> = {
  microsoft: 'Microsoft 365',
}
