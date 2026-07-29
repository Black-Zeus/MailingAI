import type { UserRole } from './auth'

export interface UserRead {
  user_id: number
  ms_object_id: string | null
  email_address: string
  display_name: string | null
  role: UserRole
  enabled: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface UserCreatePayload {
  email_address: string
  display_name?: string | null
  role?: UserRole
}

export interface UserUpdatePayload {
  display_name?: string | null
  role?: UserRole
  enabled?: boolean
}

export interface UserDirectoryEntry {
  user_id: number
  email_address: string
  display_name: string | null
}

export interface UserMailboxAccessEntry {
  mailbox_account_id: number
  label: string
  email_address: string | null
  enabled: boolean
  relation: 'owner' | 'read'
}
