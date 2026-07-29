export interface AttachmentRead {
  attachment_id: string
  file_name: string
  extension: string | null
  content_type: string | null
  size_bytes: number | null
  file_date: string | null
  matches_naming_convention: boolean
  matches_search_pattern: boolean | null
  content_sha256: string | null
}

export interface AttachmentListItem {
  attachment_id: string
  message_id: string
  file_name: string
  extension: string | null
  content_type: string | null
  size_bytes: number | null
  file_date: string | null
  matches_naming_convention: boolean
  matches_search_pattern: boolean | null
  content_sha256: string | null
  content_sha256_computed_at: string | null
  message_subject: string | null
  message_from_address: string | null
  message_sent_datetime: string | null
  folder_path: string | null
  mailbox_account_id: number | null
  mailbox_label: string | null
  linked_to_case: boolean
}

export interface MessageListItem {
  message_id: string
  conversation_id: string | null
  subject: string | null
  from_address: string | null
  from_name: string | null
  sent_datetime: string | null
  has_attachments: boolean
  is_sent: boolean
  folder_id: string | null
  folder_path: string | null
  mailbox_account_id: number | null
  mailbox_label: string | null
  attachments: AttachmentRead[]
}

export interface MessageDetail {
  message_id: string
  conversation_id: string | null
  internet_message_id: string | null
  subject: string | null
  from_address: string | null
  from_name: string | null
  to_addresses: string[]
  cc_addresses: string[]
  sent_datetime: string | null
  received_datetime: string | null
  has_attachments: boolean
  importance: string | null
  is_sent: boolean
  categories: string[]
  body_preview: string | null
  body_content: string | null
  body_content_type: string
  web_link: string | null
  folder_id: string | null
  folder_path: string | null
  mailbox_account_id: number | null
  mailbox_label: string | null
  attachments: AttachmentRead[]
}

export interface ConversationRead {
  conversation_id: string
  message_count: number
  first_message_at: string | null
  last_message_at: string | null
  participants: string[]
  messages: MessageListItem[]
}

export interface MailFolderNode {
  folder_id: string
  parent_folder_id: string | null
  display_name: string
  folder_path: string | null
  child_folder_count: number
  total_item_count: number
  last_sync_at: string | null
  children: MailFolderNode[]
}

export interface MessageFilters {
  folder_id?: string
  date_from?: string
  date_to?: string
  from_address?: string
  subject_contains?: string
  text_search?: string
  text_contains?: string
  has_attachments?: boolean
  attachment_pattern?: string
  mailbox_account_id?: number
  limit?: number
  offset?: number
}
