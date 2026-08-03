export interface TenantConfigRead {
  tenant_config_id: number
  label: string
  ms_tenant_id: string
  ms_client_id: string
  has_client_secret: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}
