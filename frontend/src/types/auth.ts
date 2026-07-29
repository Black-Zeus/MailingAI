export type UserRole = 'admin' | 'user'

export interface CurrentUser {
  user_id: number
  email_address: string
  display_name: string | null
  role: UserRole
}
