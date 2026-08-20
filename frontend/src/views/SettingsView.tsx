import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  activateAIProviderRole,
  deactivateAIProviderRole,
  assignMailboxTenant,
  cancelMailboxIndex,
  claimMailbox,
  createAIProvider,
  createTenantConfig,
  createUser,
  deleteAIProvider,
  deleteTenantConfig,
  deleteFinishedMailboxIndexRuns,
  deleteMailbox,
  getMailboxDeletionImpact,
  getAIHealth,
  getAIPolicy,
  getLatestMailboxIndex,
  getMailboxIndexRun,
  getMailboxConnectUrl,
  getNotificationSender,
  listAIEmbeddingModels,
  listAIProviderModels,
  listAIProviders,
  listMailboxes,
  listMailboxIndexRuns,
  listMailboxShares,
  listTenantConfigs,
  listUserDirectory,
  deleteUser,
  getUserDeletionImpact,
  listUsers,
  resetUserPassword,
  revokeMailboxShare,
  setNotificationSender,
  shareMailbox,
  startMailboxIndex,
  testAIProvider,
  testMailbox,
  testNotificationSender,
  triggerMailboxDeltaSync,
  updateAIPolicy,
  updateAIProvider,
  updateMailbox,
  updateTenantConfig,
  updateUser,
} from '../api/client'
import type { AIHealthResponse, AIPolicy, AIProviderRead, AIProviderRole, AIProviderType } from '../types/ai'
import { AI_POLICY_LABELS, AI_PROVIDER_TYPE_LABELS, isLocalProviderType, NUM_CTX_OPTIONS } from '../types/ai'
import type { MailboxAccountRead, MailboxDeletionImpact, MailboxShareRead } from '../types/mailboxes'
import type { UserDeletionImpact, UserDirectoryEntry, UserRead } from '../types/users'
import type { TenantConfigRead } from '../types/tenants'
import type { MailboxIndexRunRead, MailboxIndexStatus } from '../types/mailboxIndex'
import { MAILBOX_INDEX_STATUS_LABELS } from '../types/mailboxIndex'
import { MailboxIndexProgress } from '../components/MailboxIndexProgress'
import { formatNumber } from '../utils/format'
import { ConfirmModal } from '../components/ConfirmModal'
import { ShareModal, type PendingShareChanges } from '../components/ShareModal'
import { UserDetailModal } from '../components/UserDetailModal'
import { UserFormModal, type UserFormValues } from '../components/UserFormModal'
import { ActionButton } from '../components/ActionButton'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  FolderSync,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Zap,
} from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useModalBehavior } from '../utils/modalScrollLock'

interface ProviderFormState {
  label: string
  provider_type: AIProviderType
  base_url: string
  model: string
  num_ctx: number
  embeddings_model: string
  api_key: string
}

const EMPTY_FORM: ProviderFormState = {
  label: '',
  provider_type: 'ollama',
  base_url: '',
  model: '',
  num_ctx: 8192,
  embeddings_model: 'bge-m3',
  api_key: '',
}

interface TenantFormState {
  label: string
  ms_tenant_id: string
  ms_client_id: string
  ms_client_secret: string
  is_active: boolean
}

const EMPTY_TENANT_FORM: TenantFormState = {
  label: '',
  ms_tenant_id: '',
  ms_client_id: '',
  ms_client_secret: '',
  is_active: true,
}

const MODEL_PLACEHOLDER: Record<AIProviderType, string> = {
  ollama: 'ej. qwen2.5:3b',
  openai: 'ej. gpt-4o-mini',
  anthropic: 'ej. claude-3-5-sonnet-20241022',
}

// Etiqueta "Chat:"/"Embeddings:" clickeable que prende/apaga ese rol -- el
// control queda pegado al nombre del modelo que afecta, sin ambigüedad
// sobre "cuál botón hace qué" (antes eran dos ActionButton ícono-only
// indistinguibles salvo por tooltip). Usa el atributo title nativo, no el
// mecanismo de tooltip CSS (data-tooltip) del resto de la app -- ese tooltip
// pasa a display:block en hover y, con etiquetas largas cerca del borde de
// la tabla, se salía del ancho y disparaba el scroll horizontal de
// .table-wrap. El ⚡ delante del label cuando active=true es ayuda visual
// extra al color: --accent-2 vs --muted no se distinguen bien a primera
// vista en la tabla.
function RoleToggleLabel({
  label,
  active,
  loading,
  disabled,
  title,
  onClick,
}: {
  label: string
  active: boolean
  loading?: boolean
  disabled?: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      style={{
        fontWeight: 600,
        color: active ? 'var(--accent-2)' : 'var(--muted)',
        background: 'none',
        border: 'none',
        padding: 0,
        margin: 0,
        font: 'inherit',
        cursor: disabled || loading ? 'default' : 'pointer',
        textDecoration: 'underline dotted',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {active ? '⚡ ' : ''}
      {label}:{loading ? '…' : ''}
    </button>
  )
}

type SettingsTab = 'mailboxes' | 'indexing' | 'ai' | 'notifications' | 'users'

const TAB_LABELS: Record<SettingsTab, string> = {
  mailboxes: 'Buzones',
  indexing: 'Indexación',
  ai: 'Inteligencia artificial',
  notifications: 'Notificaciones',
  users: 'Usuarios',
}

const ROLE_LABELS: Record<string, string> = {
  user: 'Usuario',
  admin: 'Admin',
}

const MAILBOX_INDEX_ACTIVE_STATUSES: MailboxIndexStatus[] = ['queued', 'running']
const MAILBOX_INDEX_TERMINAL_STATUSES: MailboxIndexStatus[] = ['success', 'partial', 'failed', 'cancelled']

const MAILBOX_INDEX_STATUS_BADGE: Record<MailboxIndexStatus, string> = {
  queued: 'queued',
  running: 'running',
  success: 'success',
  partial: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
}

export function SettingsView() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<SettingsTab>('mailboxes')

  const [health, setHealth] = useState<AIHealthResponse | null>(null)
  const [providers, setProviders] = useState<AIProviderRead[] | null>(null)
  const [policy, setPolicy] = useState<AIPolicy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [activatingRoleKey, setActivatingRoleKey] = useState<string | null>(null)
  const [testingProviderId, setTestingProviderId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIProviderRead | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedEmbeddingModels, setFetchedEmbeddingModels] = useState<string[] | null>(null)
  const [fetchingEmbeddingModels, setFetchingEmbeddingModels] = useState(false)

  const [mailboxes, setMailboxes] = useState<MailboxAccountRead[] | null>(null)
  const [mailboxError, setMailboxError] = useState<string | null>(null)
  const [userDirectory, setUserDirectory] = useState<UserDirectoryEntry[]>([])
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [newMailboxLabel, setNewMailboxLabel] = useState('')
  const [selectedTenantConfigId, setSelectedTenantConfigId] = useState<number | ''>('')
  const [tenants, setTenants] = useState<TenantConfigRead[] | null>(null)
  const [tenantFormOpen, setTenantFormOpen] = useState(false)
  const [editingTenantId, setEditingTenantId] = useState<number | null>(null)
  const [tenantForm, setTenantForm] = useState<TenantFormState>(EMPTY_TENANT_FORM)
  const [savingTenant, setSavingTenant] = useState(false)
  const [deleteTenantTarget, setDeleteTenantTarget] = useState<TenantConfigRead | null>(null)
  const [deletingTenant, setDeletingTenant] = useState(false)
  const [expandedTenantId, setExpandedTenantId] = useState<number | null>(null)
  useModalBehavior(formOpen || connectModalOpen || tenantFormOpen)
  const [connecting, setConnecting] = useState(false)
  const [togglingMailboxId, setTogglingMailboxId] = useState<number | null>(null)
  const [assigningTenantMailboxId, setAssigningTenantMailboxId] = useState<number | null>(null)
  const [claimingMailboxId, setClaimingMailboxId] = useState<number | null>(null)
  const [testingMailboxId, setTestingMailboxId] = useState<number | null>(null)
  const [deleteMailboxTarget, setDeleteMailboxTarget] = useState<MailboxAccountRead | null>(null)
  const [deletingMailbox, setDeletingMailbox] = useState(false)
  const [deleteMailboxImpact, setDeleteMailboxImpact] = useState<MailboxDeletionImpact | null>(null)
  const [loadingDeleteMailboxImpact, setLoadingDeleteMailboxImpact] = useState(false)
  const [shareMailboxTarget, setShareMailboxTarget] = useState<MailboxAccountRead | null>(null)
  const [mailboxShares, setMailboxShares] = useState<MailboxShareRead[]>([])
  const [sharingMailbox, setSharingMailbox] = useState(false)

  const [users, setUsers] = useState<UserRead[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [detailUser, setDetailUser] = useState<UserRead | null>(null)
  const [userFormOpen, setUserFormOpen] = useState(false)
  const [userFormMode, setUserFormMode] = useState<'create' | 'edit'>('create')
  const [editingUserTarget, setEditingUserTarget] = useState<UserRead | null>(null)
  const [savingUserForm, setSavingUserForm] = useState(false)
  const [userToggleTarget, setUserToggleTarget] = useState<UserRead | null>(null)
  const [togglingUser, setTogglingUser] = useState(false)
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserRead | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserRead | null>(null)
  const [deleteUserImpact, setDeleteUserImpact] = useState<UserDeletionImpact | null>(null)
  const [loadingDeleteUserImpact, setLoadingDeleteUserImpact] = useState(false)
  const [deletingUser, setDeletingUser] = useState(false)

  const [activeMailboxIndex, setActiveMailboxIndex] = useState<MailboxIndexRunRead | null>(null)
  const [mailboxIndexHistory, setMailboxIndexHistory] = useState<MailboxIndexRunRead[]>([])
  const [selectedIndexMailboxId, setSelectedIndexMailboxId] = useState<number | ''>('')
  const [startingMailboxIndex, setStartingMailboxIndex] = useState(false)
  const [triggeringDeltaSync, setTriggeringDeltaSync] = useState(false)
  const [triggeringDeltaSyncMailboxId, setTriggeringDeltaSyncMailboxId] = useState<number | null>(null)
  const [cancellingMailboxIndex, setCancellingMailboxIndex] = useState(false)
  const [clearMailboxIndexModalOpen, setClearMailboxIndexModalOpen] = useState(false)
  const [clearingMailboxIndexHistory, setClearingMailboxIndexHistory] = useState(false)
  const [refreshingMailboxIndex, setRefreshingMailboxIndex] = useState(false)
  const [expandedIndexRunId, setExpandedIndexRunId] = useState<string | null>(null)
  const [expandedIndexRunDetail, setExpandedIndexRunDetail] = useState<MailboxIndexRunRead | null>(null)
  const [loadingExpandedIndexRun, setLoadingExpandedIndexRun] = useState(false)
  const mailboxIndexPollRef = useRef<number | null>(null)

  const [notificationSender, setNotificationSenderState] = useState<MailboxAccountRead | null>(null)
  const [loadingSender, setLoadingSender] = useState(false)
  const [savingSender, setSavingSender] = useState(false)
  const [testingSender, setTestingSender] = useState(false)
  const [pendingSenderId, setPendingSenderId] = useState<number | ''>('')
  const [pendingPolicy, setPendingPolicy] = useState<AIPolicy | null>(null)

  async function loadAll() {
    try {
      const [healthData, providersData, policyData] = await Promise.all([
        getAIHealth(),
        listAIProviders(),
        getAIPolicy(),
      ])
      setHealth(healthData)
      setProviders(providersData)
      setPolicy(policyData.policy)
      setPendingPolicy(policyData.policy)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo consultar el estado de IA.')
    }
  }

  async function loadMailboxes() {
    try {
      const data = await listMailboxes()
      setMailboxes(data)
      setMailboxError(null)
    } catch (err) {
      setMailboxError(err instanceof ApiError ? err.message : 'No se pudo consultar las cuentas de buzón.')
    }
  }

  async function loadTenants() {
    try {
      const data = await listTenantConfigs()
      setTenants(data)
      setSelectedTenantConfigId((prev) => {
        if (prev !== '' && data.some((t) => t.tenant_config_id === prev && t.is_active)) return prev
        return data.find((t) => t.is_active)?.tenant_config_id ?? ''
      })
    } catch {
      setTenants([])
    }
  }

  async function loadMailboxIndexHistory() {
    try {
      setMailboxIndexHistory(await listMailboxIndexRuns(10))
    } catch {
      setMailboxIndexHistory([])
    }
  }

  function stopMailboxIndexPolling() {
    if (mailboxIndexPollRef.current !== null) {
      window.clearInterval(mailboxIndexPollRef.current)
      mailboxIndexPollRef.current = null
    }
  }

  function startMailboxIndexPolling() {
    stopMailboxIndexPolling()
    mailboxIndexPollRef.current = window.setInterval(async () => {
      try {
        const run = await getLatestMailboxIndex()
        setActiveMailboxIndex(run)
        if (run && MAILBOX_INDEX_TERMINAL_STATUSES.includes(run.status)) {
          stopMailboxIndexPolling()
          await loadMailboxIndexHistory()
          showToast(
            run.status === 'success'
              ? `Indexación completa: ${formatNumber(run.total_messages_indexed)} correo(s) en ${formatNumber(run.total_folders)} carpeta(s).`
              : run.status === 'partial'
                ? `Indexación terminada con carpetas incompletas — ${formatNumber(run.total_messages_indexed)} correo(s) indexados.`
                : run.status === 'cancelled'
                  ? 'Indexación cancelada.'
                  : `La indexación falló: ${run.error_message ?? 'sin detalle'}.`,
            run.status === 'failed' || run.status === 'partial',
          )
        }
      } catch {
        // se reintenta en el siguiente tick
      }
    }, 4000)
  }

  async function handleStartMailboxIndex(mailboxAccountId: number) {
    setStartingMailboxIndex(true)
    try {
      const run = await startMailboxIndex(mailboxAccountId)
      setActiveMailboxIndex(run)
      setTab('indexing')
      startMailboxIndexPolling()
      showToast('Indexación completa iniciada — es una tarea desatendida, no hace falta quedarse esperando.')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo iniciar la indexación completa.', true)
    } finally {
      setStartingMailboxIndex(false)
    }
  }

  async function handleTriggerDeltaSync() {
    setTriggeringDeltaSync(true)
    try {
      await triggerMailboxDeltaSync()
      showToast('Sincronización delta iniciada — es una ejecución automática en segundo plano, no hace falta quedarse esperando.')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo disparar la sincronización delta.', true)
    } finally {
      setTriggeringDeltaSync(false)
    }
  }

  async function handleTriggerDeltaSyncForMailbox(mailbox: MailboxAccountRead) {
    setTriggeringDeltaSyncMailboxId(mailbox.mailbox_account_id)
    try {
      await triggerMailboxDeltaSync(mailbox.mailbox_account_id)
      showToast(`Sincronización de "${mailbox.label}" iniciada — es una ejecución automática en segundo plano.`)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo disparar la sincronización de este buzón.', true)
    } finally {
      setTriggeringDeltaSyncMailboxId(null)
    }
  }

  async function handleCancelMailboxIndex() {
    if (!activeMailboxIndex) return
    setCancellingMailboxIndex(true)
    try {
      const run = await cancelMailboxIndex(activeMailboxIndex.index_run_id)
      setActiveMailboxIndex(run)
      showToast('Cancelación solicitada — se detiene en cuanto termine el paso en curso.')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cancelar la indexación.', true)
    } finally {
      setCancellingMailboxIndex(false)
    }
  }

  async function handleRefreshMailboxIndex() {
    setRefreshingMailboxIndex(true)
    try {
      const run = await getLatestMailboxIndex()
      setActiveMailboxIndex(run)
      await loadMailboxIndexHistory()
      if (run && MAILBOX_INDEX_ACTIVE_STATUSES.includes(run.status) && mailboxIndexPollRef.current === null) {
        startMailboxIndexPolling()
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo actualizar el estado de indexación.', true)
    } finally {
      setRefreshingMailboxIndex(false)
    }
  }

  async function handleToggleHistoryRow(run: MailboxIndexRunRead) {
    if (expandedIndexRunId === run.index_run_id) {
      setExpandedIndexRunId(null)
      setExpandedIndexRunDetail(null)
      return
    }
    setExpandedIndexRunId(run.index_run_id)
    setExpandedIndexRunDetail(null)
    setLoadingExpandedIndexRun(true)
    try {
      setExpandedIndexRunDetail(await getMailboxIndexRun(run.index_run_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cargar el detalle de esta corrida.', true)
      setExpandedIndexRunId(null)
    } finally {
      setLoadingExpandedIndexRun(false)
    }
  }

  async function handleClearMailboxIndexHistory() {
    setClearingMailboxIndexHistory(true)
    try {
      const result = await deleteFinishedMailboxIndexRuns()
      showToast(`${result.deleted} corrida(s) eliminada(s) del historial`)
      setClearMailboxIndexModalOpen(false)
      await loadMailboxIndexHistory()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo limpiar el historial.', true)
    } finally {
      setClearingMailboxIndexHistory(false)
    }
  }

  async function loadUserDirectory() {
    try {
      setUserDirectory(await listUserDirectory())
    } catch {
      setUserDirectory([])
    }
  }

  async function loadUsers() {
    setUsersLoading(true)
    try {
      setUsers(await listUsers())
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cargar la lista de usuarios.', true)
    } finally {
      setUsersLoading(false)
    }
  }

  function ownerLabel(ownerUserId: number | null): string {
    if (ownerUserId === null) return 'Sin asignar'
    if (ownerUserId === user?.user_id) return 'Tú'
    const match = userDirectory.find((u) => u.user_id === ownerUserId)
    return match ? match.display_name || match.email_address : `Usuario #${ownerUserId}`
  }

  async function loadNotificationSender() {
    setLoadingSender(true)
    try {
      const data = await getNotificationSender()
      setNotificationSenderState(data)
      setPendingSenderId(data?.mailbox_account_id ?? '')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo consultar el remitente de notificaciones.', true)
    } finally {
      setLoadingSender(false)
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadAll()
      loadNotificationSender()
      loadUsers()
      loadTenants()
    }
    loadMailboxes()
    loadUserDirectory()
    function onFocus() {
      loadMailboxes()
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'mailingai-mailbox-connected') return
      setConnectModalOpen(false)
      setNewMailboxLabel('')
      claimMailbox(event.data.mailbox_account_id)
        .then(() => showToast(`Cuenta conectada: ${event.data.email_address}`))
        .catch((err) =>
          showToast(
            err instanceof ApiError ? err.message : 'Cuenta conectada, pero no se pudo asignar como dueño.',
            true,
          ),
        )
        .finally(() => loadMailboxes())
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('message', onMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  useEffect(() => {
    // Al montar (incluye recargar la página), retoma una indexación que haya
    // quedado corriendo en el servidor -- el progreso vive ahí, no se pierde
    // con un refresh ni si se cambia de pestaña.
    if (!isAdmin) return
    loadMailboxIndexHistory()
    getLatestMailboxIndex()
      .then((run) => {
        setActiveMailboxIndex(run)
        if (run && MAILBOX_INDEX_ACTIVE_STATUSES.includes(run.status)) {
          startMailboxIndexPolling()
        }
      })
      .catch(() => {})
    return () => stopMailboxIndexPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function handleTest() {
    setTesting(true)
    try {
      const data = await getAIHealth()
      setHealth(data)
      if (!data.active_provider) {
        showToast('No hay ningún proveedor activo.', true)
      } else {
        showToast(
          data.healthy
            ? `Conexión verificada · ${data.active_provider.label} (${data.active_provider.model})`
            : `Atención: ${data.active_provider.label} no respondió.`,
          !data.healthy,
        )
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo probar la conexión.', true)
    } finally {
      setTesting(false)
    }
  }

  async function handleSavePolicy() {
    if (pendingPolicy === null) return
    setSavingPolicy(true)
    try {
      const result = await updateAIPolicy(pendingPolicy)
      setPolicy(result.policy)
      setPendingPolicy(result.policy)
      showToast('Política de IA actualizada')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar la política.', true)
    } finally {
      setSavingPolicy(false)
    }
  }

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFetchedModels(null)
    setFetchedEmbeddingModels(null)
    setFormOpen(true)
  }

  function openEditForm(provider: AIProviderRead) {
    setEditingId(provider.provider_id)
    setForm({
      label: provider.label,
      provider_type: provider.provider_type,
      base_url: provider.base_url ?? '',
      model: provider.model,
      num_ctx: provider.num_ctx,
      embeddings_model: provider.embeddings_model,
      api_key: '',
    })
    setFetchedModels(null)
    setFetchedEmbeddingModels(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setFetchedModels(null)
    setFetchedEmbeddingModels(null)
  }

  function setProviderType(next: AIProviderType) {
    setForm((f) => ({ ...f, provider_type: next }))
    setFetchedModels(null)
    setFetchedEmbeddingModels(null)
  }

  async function handleFetchModels() {
    setFetchingModels(true)
    setFetchedModels(null)
    try {
      const result = await listAIProviderModels({
        provider_type: form.provider_type,
        base_url: form.base_url.trim() || null,
        api_key: form.api_key.trim() || null,
        provider_id: editingId,
      })
      setFetchedModels(result.models)
      if (result.models.length === 0) {
        showToast('El proveedor no devolvió ningún modelo.', true)
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudieron recuperar los modelos del proveedor.', true)
    } finally {
      setFetchingModels(false)
    }
  }

  async function handleFetchEmbeddingModels() {
    setFetchingEmbeddingModels(true)
    setFetchedEmbeddingModels(null)
    try {
      const result = await listAIEmbeddingModels({
        provider_type: form.provider_type,
        base_url: form.base_url.trim() || null,
        api_key: form.api_key.trim() || null,
        provider_id: editingId,
      })
      setFetchedEmbeddingModels(result.models)
      if (result.models.length === 0) {
        showToast('El proveedor no tiene ningún modelo con capacidad de embeddings.', true)
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudieron recuperar los modelos de embeddings.', true)
    } finally {
      setFetchingEmbeddingModels(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        label: form.label.trim(),
        provider_type: form.provider_type,
        base_url: form.base_url.trim() || null,
        model: form.model.trim(),
        num_ctx: form.num_ctx,
        embeddings_model: form.embeddings_model.trim() || 'bge-m3',
        api_key: form.api_key.trim() || null,
      }
      if (editingId) {
        await updateAIProvider(editingId, payload)
        showToast('Proveedor actualizado')
      } else {
        await createAIProvider(payload)
        showToast('Proveedor agregado')
      }
      closeForm()
      await loadAll()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo guardar el proveedor.', true)
    } finally {
      setSaving(false)
    }
  }

  async function handleTestProvider(provider: AIProviderRead) {
    setTestingProviderId(provider.provider_id)
    try {
      const result = await testAIProvider(provider.provider_id)
      showToast(
        result.healthy
          ? `${provider.label} respondió correctamente.`
          : `${provider.label} no respondió.`,
        !result.healthy,
      )
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo probar este proveedor.', true)
    } finally {
      setTestingProviderId(null)
    }
  }

  const ROLE_LABEL: Record<AIProviderRole, string> = { chat: 'consultas', embeddings: 'embeddings' }

  async function handleToggleRole(provider: AIProviderRead, role: AIProviderRole) {
    const isActive = role === 'chat' ? provider.is_chat_active : provider.is_embeddings_active
    const key = `${provider.provider_id}:${role}`
    setActivatingRoleKey(key)
    try {
      if (isActive) {
        await deactivateAIProviderRole(provider.provider_id, role)
        showToast(`${provider.label}: ya no se usa para ${ROLE_LABEL[role]}`)
      } else {
        await activateAIProviderRole(provider.provider_id, role)
        showToast(`${provider.label}: ahora se usa para ${ROLE_LABEL[role]}`)
      }
      await loadAll()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar el rol del proveedor.', true)
    } finally {
      setActivatingRoleKey(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteAIProvider(deleteTarget.provider_id)
      showToast('Proveedor eliminado')
      setDeleteTarget(null)
      await loadAll()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar el proveedor.', true)
    } finally {
      setDeleting(false)
    }
  }

  function openConnectModal(tenantConfigId?: number) {
    setNewMailboxLabel('')
    if (tenantConfigId) setSelectedTenantConfigId(tenantConfigId)
    setConnectModalOpen(true)
  }

  function openTenantForm(tenant?: TenantConfigRead) {
    if (tenant) {
      setEditingTenantId(tenant.tenant_config_id)
      setTenantForm({
        label: tenant.label,
        ms_tenant_id: tenant.ms_tenant_id,
        ms_client_id: tenant.ms_client_id,
        ms_client_secret: '',
        is_active: tenant.is_active,
      })
    } else {
      setEditingTenantId(null)
      setTenantForm(EMPTY_TENANT_FORM)
    }
    setTenantFormOpen(true)
  }

  function closeTenantForm() {
    setTenantFormOpen(false)
  }

  async function handleTenantSubmit(e: FormEvent) {
    e.preventDefault()
    setSavingTenant(true)
    try {
      const payload = {
        label: tenantForm.label,
        ms_tenant_id: tenantForm.ms_tenant_id,
        ms_client_id: tenantForm.ms_client_id,
        ms_client_secret: tenantForm.ms_client_secret.trim() || null,
        is_active: tenantForm.is_active,
      }
      if (editingTenantId) {
        await updateTenantConfig(editingTenantId, payload)
      } else {
        if (!tenantForm.ms_client_secret.trim()) {
          showToast('El client secret es obligatorio para un tenant nuevo.', true)
          setSavingTenant(false)
          return
        }
        await createTenantConfig(payload)
      }
      showToast(editingTenantId ? 'Tenant actualizado' : 'Tenant agregado')
      setTenantFormOpen(false)
      await loadTenants()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo guardar el tenant.', true)
    } finally {
      setSavingTenant(false)
    }
  }

  async function handleDeleteTenant() {
    if (!deleteTenantTarget) return
    setDeletingTenant(true)
    try {
      await deleteTenantConfig(deleteTenantTarget.tenant_config_id)
      showToast('Tenant eliminado')
      setDeleteTenantTarget(null)
      await loadTenants()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar el tenant.', true)
    } finally {
      setDeletingTenant(false)
    }
  }

  async function handleConnectMailbox() {
    const label = newMailboxLabel.trim()
    if (!label) {
      showToast('Escribe un nombre para la cuenta antes de conectarla (ej. "Mesa", "Agente Juan").', true)
      return
    }
    if (!selectedTenantConfigId) {
      showToast('Selecciona a qué tenant de Microsoft pertenece esta cuenta.', true)
      return
    }
    setConnecting(true)
    try {
      const { url } = await getMailboxConnectUrl(label, selectedTenantConfigId)
      const width = 520
      const height = 680
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
      const popup = window.open(
        url,
        'mailingai-oauth',
        `width=${width},height=${height},left=${left},top=${top}`,
      )
      if (!popup) {
        showToast('El navegador bloqueó la ventana emergente. Permití popups para este sitio e intenta de nuevo.', true)
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo iniciar la conexión de la cuenta.', true)
    } finally {
      setConnecting(false)
    }
  }

  async function handleClaimMailbox(mailbox: MailboxAccountRead) {
    setClaimingMailboxId(mailbox.mailbox_account_id)
    try {
      await claimMailbox(mailbox.mailbox_account_id)
      showToast(`Ahora eres el dueño de "${mailbox.label}".`)
      await loadMailboxes()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo reclamar este buzón.', true)
    } finally {
      setClaimingMailboxId(null)
    }
  }

  async function handleTestMailbox(mailbox: MailboxAccountRead) {
    setTestingMailboxId(mailbox.mailbox_account_id)
    try {
      const result = await testMailbox(mailbox.mailbox_account_id)
      showToast(`Conexión verificada · ${result.display_name || result.email_address || 'sin datos de perfil'}`)
      await loadMailboxes()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo probar la conexión de esta cuenta.', true)
    } finally {
      setTestingMailboxId(null)
    }
  }

  async function handleToggleMailboxEnabled(mailbox: MailboxAccountRead) {
    setTogglingMailboxId(mailbox.mailbox_account_id)
    try {
      await updateMailbox(mailbox.mailbox_account_id, { enabled: !mailbox.enabled })
      showToast(mailbox.enabled ? 'Cuenta deshabilitada' : 'Cuenta habilitada')
      await loadMailboxes()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado de la cuenta.', true)
    } finally {
      setTogglingMailboxId(null)
    }
  }

  async function handleAssignMailboxTenant(mailbox: MailboxAccountRead, tenantConfigId: number) {
    setAssigningTenantMailboxId(mailbox.mailbox_account_id)
    try {
      await assignMailboxTenant(mailbox.mailbox_account_id, tenantConfigId)
      showToast(`Tenant asignado a "${mailbox.label}"`)
      await loadMailboxes()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo asignar el tenant.', true)
    } finally {
      setAssigningTenantMailboxId(null)
    }
  }

  function renderMailboxRow(m: MailboxAccountRead) {
    const canManage = isAdmin || m.owner_user_id === user?.user_id
    return (
      <tr key={m.mailbox_account_id}>
        <td>
          <span className={`badge ${m.enabled ? 'success' : ''}`}>{m.enabled ? 'Habilitada' : 'Deshabilitada'}</span>
        </td>
        <td>
          <div>{m.label}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {m.email_address || '—'}
          </div>
        </td>
        <td>
          {ownerLabel(m.owner_user_id)}
          {m.is_notification_sender && <span className="badge success ml-2">notificaciones</span>}
        </td>
        {isAdmin && (
          <td>
            {m.tenant_config_id ? (
              tenants?.find((t) => t.tenant_config_id === m.tenant_config_id)?.label || `Tenant #${m.tenant_config_id}`
            ) : (
              <select
                aria-label={`Asignar tenant a ${m.label}`}
                value=""
                disabled={assigningTenantMailboxId === m.mailbox_account_id}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null
                  if (next) handleAssignMailboxTenant(m, next)
                }}
                style={{ fontSize: 12, padding: '6px 8px' }}
              >
                <option value="">Sin asignar — elegir…</option>
                {tenants?.map((t) => (
                  <option key={t.tenant_config_id} value={t.tenant_config_id}>
                    {t.label || `Tenant #${t.tenant_config_id}`}
                  </option>
                ))}
              </select>
            )}
          </td>
        )}
        <td>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <ActionButton
              icon={Zap}
              label="Probar conexión"
              variant="primary"
              loading={testingMailboxId === m.mailbox_account_id}
              onClick={() => handleTestMailbox(m)}
            />
            {m.owner_user_id === null && (
              <ActionButton
                icon={Flag}
                label="Reclamar"
                variant="primary"
                loading={claimingMailboxId === m.mailbox_account_id}
                onClick={() => handleClaimMailbox(m)}
              />
            )}
            {isAdmin && (
              <ActionButton
                icon={FolderSync}
                label="Indexar buzón completo"
                disabled={mailboxIndexBusy}
                onClick={() => handleStartMailboxIndex(m.mailbox_account_id)}
              />
            )}
            {isAdmin && (
              <ActionButton
                icon={RefreshCw}
                label="Sincronizar (solo lo nuevo desde la última corrida)"
                loading={triggeringDeltaSyncMailboxId === m.mailbox_account_id}
                onClick={() => handleTriggerDeltaSyncForMailbox(m)}
              />
            )}
            {canManage && <ActionButton icon={Share2} label="Compartir" onClick={() => openShareMailboxModal(m)} />}
            {canManage && (
              <ActionButton
                icon={m.enabled ? Pause : Play}
                label={m.enabled ? 'Deshabilitar' : 'Habilitar'}
                loading={togglingMailboxId === m.mailbox_account_id}
                onClick={() => handleToggleMailboxEnabled(m)}
              />
            )}
            {isAdmin && (
              <ActionButton icon={Trash2} label="Eliminar" variant="danger" onClick={() => openDeleteMailboxModal(m)} />
            )}
          </div>
        </td>
      </tr>
    )
  }

  async function openShareMailboxModal(mailbox: MailboxAccountRead) {
    setShareMailboxTarget(mailbox)
    try {
      setMailboxShares(await listMailboxShares(mailbox.mailbox_account_id))
    } catch (err) {
      setMailboxShares([])
      showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar las comparticiones.', true)
    }
  }

  async function handleConfirmMailboxShares(changes: PendingShareChanges) {
    if (!shareMailboxTarget) return
    setSharingMailbox(true)
    let casesAffected = 0
    let failCount = 0
    for (const add of changes.adds) {
      try {
        await shareMailbox(shareMailboxTarget.mailbox_account_id, add.userId, 'read')
      } catch {
        failCount += 1
      }
    }
    for (const userId of changes.removeUserIds) {
      try {
        const result = await revokeMailboxShare(shareMailboxTarget.mailbox_account_id, userId)
        casesAffected += result.cases_affected
      } catch {
        failCount += 1
      }
    }
    setMailboxShares(await listMailboxShares(shareMailboxTarget.mailbox_account_id))
    setSharingMailbox(false)
    if (failCount === 0) {
      showToast(
        casesAffected > 0
          ? `Cambios guardados. También se quitó el acceso a ${casesAffected} expediente(s) relacionado(s).`
          : 'Cambios guardados.',
      )
      setShareMailboxTarget(null)
    } else {
      showToast(`${failCount} cambio(s) no se pudieron aplicar — revisa la lista e intenta de nuevo.`, true)
    }
  }

  async function openDeleteMailboxModal(mailbox: MailboxAccountRead) {
    setDeleteMailboxTarget(mailbox)
    setDeleteMailboxImpact(null)
    setLoadingDeleteMailboxImpact(true)
    try {
      setDeleteMailboxImpact(await getMailboxDeletionImpact(mailbox.mailbox_account_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo calcular el impacto de la eliminación.', true)
    } finally {
      setLoadingDeleteMailboxImpact(false)
    }
  }

  async function handleDeleteMailbox() {
    if (!deleteMailboxTarget) return
    setDeletingMailbox(true)
    try {
      const result = await deleteMailbox(deleteMailboxTarget.mailbox_account_id)
      showToast(
        `Cuenta eliminada — ${result.message_count} correo(s), ${result.cases_deleted} expediente(s) completo(s) borrados` +
          (result.cases_affected > 0 ? `, ${result.cases_affected} expediente(s) actualizado(s).` : '.'),
      )
      setDeleteMailboxTarget(null)
      setDeleteMailboxImpact(null)
      await loadMailboxes()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar la cuenta.', true)
    } finally {
      setDeletingMailbox(false)
    }
  }

  async function handleSaveNotificationSender() {
    const mailboxAccountId = pendingSenderId === '' ? null : pendingSenderId
    setSavingSender(true)
    try {
      const result = await setNotificationSender(mailboxAccountId)
      setNotificationSenderState(result)
      setPendingSenderId(result?.mailbox_account_id ?? '')
      showToast(result ? `"${result.label}" queda como remitente de notificaciones.` : 'Se quitó el remitente de notificaciones.')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo actualizar el remitente de notificaciones.', true)
    } finally {
      setSavingSender(false)
    }
  }

  async function handleTestNotificationSender() {
    setTestingSender(true)
    try {
      await testNotificationSender()
      showToast('Correo de prueba enviado — revisa tu bandeja de entrada.')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo enviar el correo de prueba.', true)
    } finally {
      setTestingSender(false)
    }
  }

  function openCreateUserForm() {
    setUserFormMode('create')
    setEditingUserTarget(null)
    setUserFormOpen(true)
  }

  function openEditUserForm(u: UserRead) {
    setUserFormMode('edit')
    setEditingUserTarget(u)
    setUserFormOpen(true)
  }

  async function handleUserFormSubmit(values: UserFormValues) {
    setSavingUserForm(true)
    try {
      if (userFormMode === 'create') {
        await createUser({
          email_address: values.email_address.trim(),
          display_name: values.display_name.trim() || null,
          role: values.role,
          auth_method: values.auth_method,
          username: values.auth_method === 'local' ? values.username.trim() : null,
          password: values.auth_method === 'local' ? values.password : null,
        })
        showToast(
          values.auth_method === 'local'
            ? 'Cuenta local creada — comunicale la contraseña temporal por fuera del sistema.'
            : 'Usuario creado. Queda pendiente de su primer login.',
        )
      } else if (editingUserTarget) {
        await updateUser(editingUserTarget.user_id, {
          display_name: values.display_name.trim() || null,
          role: values.role,
        })
        showToast('Usuario actualizado.')
      }
      setUserFormOpen(false)
      await loadUsers()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo guardar el usuario.', true)
    } finally {
      setSavingUserForm(false)
    }
  }

  async function handleResetPassword() {
    if (!resetPasswordTarget) return
    if (resetPasswordValue.length < 8) {
      showToast('La contraseña nueva debe tener al menos 8 caracteres.', true)
      return
    }
    setResettingPassword(true)
    try {
      await resetUserPassword(resetPasswordTarget.user_id, resetPasswordValue)
      showToast('Contraseña reseteada — comunicásela a la persona por fuera del sistema, va a tener que cambiarla al entrar.')
      setResetPasswordTarget(null)
      setResetPasswordValue('')
      await loadUsers()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo resetear la contraseña.', true)
    } finally {
      setResettingPassword(false)
    }
  }

  async function openDeleteUserModal(target: UserRead) {
    setDeleteUserTarget(target)
    setDeleteUserImpact(null)
    setLoadingDeleteUserImpact(true)
    try {
      setDeleteUserImpact(await getUserDeletionImpact(target.user_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo calcular el impacto de la eliminación.', true)
    } finally {
      setLoadingDeleteUserImpact(false)
    }
  }

  async function handleDeleteUser() {
    if (!deleteUserTarget) return
    setDeletingUser(true)
    try {
      const result = await deleteUser(deleteUserTarget.user_id)
      showToast(
        result.cases_reassigned > 0
          ? `Usuario eliminado — ${result.cases_reassigned} expediente(s) quedaron a tu nombre (con nota de a quién pertenecían).`
          : 'Usuario eliminado.',
      )
      setDeleteUserTarget(null)
      setDeleteUserImpact(null)
      await loadUsers()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar el usuario.', true)
    } finally {
      setDeletingUser(false)
    }
  }

  async function handleConfirmToggleUser() {
    if (!userToggleTarget) return
    setTogglingUser(true)
    try {
      await updateUser(userToggleTarget.user_id, { enabled: !userToggleTarget.enabled })
      showToast(userToggleTarget.enabled ? 'Usuario desactivado.' : 'Usuario activado.')
      setUserToggleTarget(null)
      await loadUsers()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo actualizar el usuario.', true)
    } finally {
      setTogglingUser(false)
    }
  }

  const visibleTabs: SettingsTab[] = isAdmin
    ? ['mailboxes', 'indexing', 'ai', 'notifications', 'users']
    : ['mailboxes']
  const mailboxIndexBusy =
    activeMailboxIndex !== null && MAILBOX_INDEX_ACTIVE_STATUSES.includes(activeMailboxIndex.status)
  const unassignedMailboxes = mailboxes?.filter((m) => !m.tenant_config_id) ?? []

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Configuración</h2>
          <p>Buzones conectados{isAdmin ? ', proveedores de inteligencia artificial, notificaciones por correo y usuarios.' : '.'}</p>
        </div>
      </div>

      {visibleTabs.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--line)', paddingBottom: 14 }}>
          {visibleTabs.map((t) => (
            <button
              key={t}
              type="button"
              className={`btn${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {tab === 'mailboxes' && isAdmin && (
        <div className="panel mt-6" style={{ marginTop: 0, marginBottom: 20 }}>
          <div className="panel-head">
            <h3>Tenants de Microsoft</h3>
            <span>{tenants?.length ?? 0} registrado(s)</span>
          </div>
          <div className="panel-body">
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 14 }}>
              Un tenant es la organización de Microsoft 365 dueña de los buzones que conectás — la tuya propia, o la
              de un cliente si administrás buzones de más de una organización. Agregá cada organización acá antes de
              conectar sus buzones. Uno marcado como inactivo deja de estar disponible para conectar cuentas nuevas,
              pero los buzones que ya tenía siguen funcionando igual. Tocá la flecha de cada fila para ver sus
              buzones o conectarle uno nuevo directo.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 40 }} aria-label="Expandir"></th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Tenant ID</th>
                    <th scope="col">Client ID</th>
                    <th scope="col" style={{ width: 100 }} aria-label="Estado"></th>
                    <th scope="col" style={{ width: 140 }} aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {tenants !== null && tenants.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-view">
                        No hay ningún tenant registrado todavía.
                      </td>
                    </tr>
                  )}
                  {tenants?.map((t) => {
                    const isExpanded = expandedTenantId === t.tenant_config_id
                    const tenantMailboxes = mailboxes?.filter((m) => m.tenant_config_id === t.tenant_config_id) ?? []
                    return (
                      <Fragment key={t.tenant_config_id}>
                        <tr>
                          <td>
                            <ActionButton
                              icon={isExpanded ? ChevronDown : ChevronRight}
                              label={isExpanded ? 'Ocultar buzones' : 'Ver buzones'}
                              onClick={() => setExpandedTenantId(isExpanded ? null : t.tenant_config_id)}
                            />
                          </td>
                          <td>{t.label}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{t.ms_tenant_id}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{t.ms_client_id}</td>
                          <td>
                            <span className={`badge ${t.is_active ? 'success' : ''}`}>
                              {t.is_active ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <ActionButton
                                icon={Plus}
                                label="Conectar buzón a este tenant"
                                variant="primary"
                                onClick={() => openConnectModal(t.tenant_config_id)}
                              />
                              <ActionButton icon={Pencil} label="Editar" onClick={() => openTenantForm(t)} />
                              <ActionButton
                                icon={Trash2}
                                label="Eliminar"
                                variant="danger"
                                onClick={() => setDeleteTenantTarget(t)}
                              />
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--panel-2)' }}>
                              {tenantMailboxes.length === 0 ? (
                                <p className="text-muted" style={{ fontSize: 12, margin: '8px 0' }}>
                                  Este tenant todavía no tiene ningún buzón conectado.
                                </p>
                              ) : (
                                <div className="table-wrap" style={{ margin: '8px 0' }}>
                                  <table>
                                    <thead>
                                      <tr>
                                        <th scope="col" style={{ width: 140 }} aria-label="Estado"></th>
                                        <th scope="col">Buzón</th>
                                        <th scope="col">Dueño</th>
                                        <th scope="col">Tenant</th>
                                        <th scope="col" style={{ width: 250 }} aria-label="Acciones"></th>
                                      </tr>
                                    </thead>
                                    <tbody>{tenantMailboxes.map((m) => renderMailboxRow(m))}</tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="actions mt-6">
              <button type="button" className="btn primary btn-labeled" onClick={() => openTenantForm()}>
                ＋ Agregar tenant
              </button>
              <button type="button" className="btn btn-labeled" onClick={loadMailboxes}>
                ↻ Actualizar buzones
              </button>
            </div>

            {unassignedMailboxes.length > 0 && (
              <div className="mt-7">
                <h4 style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
                  Buzones sin organización asignada
                </h4>
                <p className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Se conectaron antes de existir esta lista de tenants — asignales uno para que queden agrupados
                  correctamente (elegí el que corresponda en la columna "Tenant" de cada fila).
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: 140 }} aria-label="Estado"></th>
                        <th scope="col">Buzón</th>
                        <th scope="col">Dueño</th>
                        <th scope="col">Tenant</th>
                        <th scope="col" style={{ width: 250 }} aria-label="Acciones"></th>
                      </tr>
                    </thead>
                    <tbody>{unassignedMailboxes.map((m) => renderMailboxRow(m))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'mailboxes' && !isAdmin && (
        <div className="panel">
          <div className="panel-head">
            <h3>Buzones</h3>
            <span>{mailboxes?.length ?? 0} cuenta(s) accesible(s)</span>
          </div>
          <div className="panel-body">
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
              Cada cuenta conectada queda disponible para correr trabajos contra ese buzón — el buzón de mesa y los
              de los agentes pueden convivir al mismo tiempo. Conectar una cuenta abre el login real de Microsoft
              en una ventana aparte; al volver, esta lista se actualiza sola. La columna "Tenant" de cada fila deja
              elegir a qué tenant registrado pertenece un buzón ya conectado (útil para los que se conectaron antes
              de existir esta tabla) — cambiarlo reemplaza las credenciales reales que usa ese buzón para renovar su
              token, así que solo hazlo si el buzón realmente pertenece al tenant que elijas, o el próximo refresh
              va a fallar.
            </p>

            {mailboxError && <p className="form-error">{mailboxError}</p>}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 140 }} aria-label="Estado"></th>
                    <th scope="col">Buzón</th>
                    <th scope="col">Dueño</th>
                    {isAdmin && <th scope="col">Tenant</th>}
                    <th scope="col" style={{ width: 250 }} aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {mailboxes !== null && mailboxes.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 5 : 4} className="empty-view">
                        No hay ninguna cuenta de buzón conectada todavía (o accesible para ti).
                      </td>
                    </tr>
                  )}
                  {mailboxes?.map((m) => renderMailboxRow(m))}
                </tbody>
              </table>
            </div>

            <div className="actions mt-6">
              <button type="button" className="btn btn-labeled" onClick={loadMailboxes}>
                ↻ Actualizar lista
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'indexing' && isAdmin && (
        <>
        <div className="panel">
          <div className="panel-head">
            <h3>Indexación completa de buzón</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{activeMailboxIndex ? MAILBOX_INDEX_STATUS_LABELS[activeMailboxIndex.status] : 'Sin corridas'}</span>
              <ActionButton icon={RefreshCw} label="Actualizar" loading={refreshingMailboxIndex} onClick={handleRefreshMailboxIndex} />
            </div>
          </div>
          <div className="panel-body">
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
              Recorre todas las carpetas de un buzón desde el principio, una carpeta a la vez y con pausas entre
              cada paso para no saturar el servidor ni Microsoft Graph. Es una tarea desatendida — se puede
              cambiar de pestaña o cerrar la app y el progreso sigue en el servidor, consultable en cualquier
              momento. Solo puede haber una corrida activa a la vez en todo el sistema.
            </p>

            {!mailboxIndexBusy && (
              <div className="field" style={{ maxWidth: 420, marginBottom: 18 }}>
                <label htmlFor="mailbox-index-select">Buzón a indexar</label>
                <select
                  id="mailbox-index-select"
                  value={selectedIndexMailboxId}
                  onChange={(e) => setSelectedIndexMailboxId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Selecciona un buzón…</option>
                  {mailboxes?.map((m) => (
                    <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                      {m.label} — {m.email_address || 'sin correo'}
                    </option>
                  ))}
                </select>
                <div className="actions mt-4">
                  <button
                    type="button"
                    className="btn primary btn-labeled"
                    disabled={startingMailboxIndex || selectedIndexMailboxId === ''}
                    onClick={() => selectedIndexMailboxId !== '' && handleStartMailboxIndex(selectedIndexMailboxId)}
                  >
                    {startingMailboxIndex ? 'Iniciando…' : '▶ Indexar buzón completo'}
                  </button>
                </div>
              </div>
            )}

            {activeMailboxIndex && mailboxIndexBusy && (
              <>
                <div className="summary" style={{ marginBottom: 16 }}>
                  <div className="summary-icon">⏳</div>
                  <div>
                    <strong style={{ fontSize: 15 }}>
                      {mailboxes?.find((m) => m.mailbox_account_id === activeMailboxIndex.mailbox_account_id)?.label ??
                        `Buzón #${activeMailboxIndex.mailbox_account_id}`}
                    </strong>
                  </div>
                </div>

                <div className="actions" style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    className="btn danger btn-labeled"
                    disabled={cancellingMailboxIndex || activeMailboxIndex.cancel_requested}
                    onClick={handleCancelMailboxIndex}
                  >
                    {activeMailboxIndex.cancel_requested ? 'Cancelando…' : '✕ Cancelar'}
                  </button>
                </div>

                <MailboxIndexProgress run={activeMailboxIndex} />
              </>
            )}

            {mailboxIndexHistory.length > 0 && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 24,
                    marginBottom: 8,
                  }}
                >
                  <h4 style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Corridas anteriores</h4>
                  <ActionButton icon={Trash2} label="Limpiar historial" variant="danger" onClick={() => setClearMailboxIndexModalOpen(true)} />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: 40 }} aria-label="Expandir"></th>
                        <th scope="col">Buzón</th>
                        <th scope="col" style={{ width: 110 }} aria-label="Estado"></th>
                        <th scope="col" style={{ width: 100 }}>Correos</th>
                        <th scope="col">Solicitada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mailboxIndexHistory.map((run) => {
                        const isExpanded = expandedIndexRunId === run.index_run_id
                        return (
                          <Fragment key={run.index_run_id}>
                            <tr>
                              <td>
                                <ActionButton
                                  icon={isExpanded ? ChevronDown : ChevronRight}
                                  label={isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                                  onClick={() => handleToggleHistoryRow(run)}
                                />
                              </td>
                              <td>
                                {mailboxes?.find((m) => m.mailbox_account_id === run.mailbox_account_id)?.label ??
                                  `Buzón #${run.mailbox_account_id}`}
                              </td>
                              <td>
                                <span className={`badge ${MAILBOX_INDEX_STATUS_BADGE[run.status]}`}>
                                  {MAILBOX_INDEX_STATUS_LABELS[run.status]}
                                </span>
                              </td>
                              <td>{formatNumber(run.total_messages_indexed)}</td>
                              <td>{new Date(run.requested_at).toLocaleString()}</td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={5} style={{ background: 'var(--panel-2)' }}>
                                  {loadingExpandedIndexRun ? (
                                    <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '8px 0' }}>Cargando…</p>
                                  ) : (
                                    expandedIndexRunDetail && <MailboxIndexProgress run={expandedIndexRunDetail} />
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel mt-7">
          <div className="panel-head">
            <h3>Sincronización delta de buzones</h3>
          </div>
          <div className="panel-body">
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
              Corre sola una vez al día (06:00) y trae solo los correos nuevos o modificados de cada buzón
              habilitado desde la última corrida — no reindexa todo el historial. Usa este botón para forzarla
              ahora mismo en vez de esperar al horario programado.
            </p>
            <ActionButton
              icon={RefreshCw}
              label={triggeringDeltaSync ? 'Disparando…' : 'Forzar sincronización ahora'}
              variant="primary"
              loading={triggeringDeltaSync}
              onClick={handleTriggerDeltaSync}
            />
          </div>
        </div>
        </>
      )}

      {tab === 'ai' && isAdmin && (
        <>
          {error && <p className="form-error">{error}</p>}

          <div className="grid">
            <div className="panel">
              <div className="panel-head">
                <h3>Proveedores</h3>
                <span>{providers?.length ?? 0} configurado(s)</span>
              </div>
              <div className="panel-body">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Nombre</th>
                        <th scope="col" style={{ width: 190 }}>Tipo</th>
                        <th scope="col">Modelo</th>
                        <th scope="col">Servidor / API key</th>
                        <th scope="col" style={{ width: 210 }} aria-label="Acciones"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {providers !== null && providers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="empty-view">
                            No hay proveedores configurados todavía.
                          </td>
                        </tr>
                      )}
                      {providers?.map((p) => (
                        <tr key={p.provider_id}>
                          <td>{p.label}</td>
                          <td>
                            {AI_PROVIDER_TYPE_LABELS[p.provider_type]}{' '}
                            <span
                              className={`badge ${isLocalProviderType(p.provider_type) ? 'success' : 'queued'}`}
                              title={
                                isLocalProviderType(p.provider_type)
                                  ? 'Local: infraestructura propia (autohospedado) — el contenido nunca sale hacia un tercero, sin importar en qué servidor de tu red corra.'
                                  : 'Externo: el contenido se envía a los servidores de este proveedor por fuera de tu infraestructura.'
                              }
                            >
                              {isLocalProviderType(p.provider_type) ? '🏠 Local' : '☁ Externo'}
                            </span>
                          </td>
                          <td className="mono">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span>
                                <RoleToggleLabel
                                  label="Chat"
                                  active={p.is_chat_active}
                                  loading={activatingRoleKey === `${p.provider_id}:chat`}
                                  disabled={
                                    !p.is_chat_active && policy === 'local_only' && !isLocalProviderType(p.provider_type)
                                  }
                                  title={
                                    !p.is_chat_active && policy === 'local_only' && !isLocalProviderType(p.provider_type)
                                      ? "Bloqueado por la política 'Solo local'"
                                      : p.is_chat_active
                                        ? 'Click para dejar de usar para consultas'
                                        : 'Click para usar para consultas'
                                  }
                                  onClick={() => handleToggleRole(p, 'chat')}
                                />{' '}
                                {p.model}
                                {p.provider_type === 'ollama' && (
                                  <span className="text-muted" style={{ fontSize: 11 }}>
                                    {' '}
                                    ({p.num_ctx.toLocaleString('es-CL')} ctx)
                                  </span>
                                )}
                              </span>
                              {p.provider_type === 'ollama' && (
                                <span>
                                  <RoleToggleLabel
                                    label="Embeddings"
                                    active={p.is_embeddings_active}
                                    loading={activatingRoleKey === `${p.provider_id}:embeddings`}
                                    title={
                                      p.is_embeddings_active
                                        ? 'Click para dejar de usar para embeddings'
                                        : 'Click para usar para embeddings'
                                    }
                                    onClick={() => handleToggleRole(p, 'embeddings')}
                                  />{' '}
                                  {p.embeddings_model}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {p.provider_type === 'ollama' ? p.base_url || '—' : p.has_api_key ? 'API key guardada' : 'sin API key'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <ActionButton
                                icon={Zap}
                                label="Probar"
                                loading={testingProviderId === p.provider_id}
                                onClick={() => handleTestProvider(p)}
                              />
                              <ActionButton icon={Pencil} label="Editar" onClick={() => openEditForm(p)} />
                              <ActionButton icon={Trash2} label="Eliminar" variant="danger" onClick={() => setDeleteTarget(p)} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="actions mt-6">
                  <button type="button" className="btn btn-labeled" onClick={openCreateForm}>
                    ＋ Agregar proveedor
                  </button>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Política</h3>
                <span>Alcance</span>
              </div>
              <div className="panel-body summary-stack">
                <div className="field">
                  <label htmlFor="ai-policy">Proveedores permitidos</label>
                  <select
                    id="ai-policy"
                    value={pendingPolicy ?? 'local_only'}
                    disabled={savingPolicy}
                    onChange={(e) => setPendingPolicy(e.target.value as AIPolicy)}
                  >
                    <option value="local_only">{AI_POLICY_LABELS.local_only}</option>
                    <option value="allow_external">{AI_POLICY_LABELS.allow_external}</option>
                  </select>
                  <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                    "Solo local" permite únicamente proveedores 🏠 Local (Ollama autohospedado — da igual si corre en
                    este equipo o en un servidor de tu red corporativa, lo que importa es que sea infraestructura
                    propia) y bloquea la activación de proveedores ☁ Externo (OpenAI/Claude), incluso si ya estaban
                    activos de antes. Cámbiala a "Permitir proveedores externos" recién cuando quieras probar uno de
                    verdad.
                  </p>
                  <div className="actions mt-4">
                    <button
                      type="button"
                      className="btn primary btn-labeled"
                      disabled={savingPolicy || pendingPolicy === policy}
                      onClick={handleSavePolicy}
                    >
                      {savingPolicy ? 'Guardando…' : '✓ Guardar'}
                    </button>
                  </div>
                </div>

                {health?.active_provider ? (
                  <div className="summary">
                    <div className="summary-icon">{health.healthy ? '✓' : '✕'}</div>
                    <div>
                      <strong style={{ fontSize: 15 }}>
                        {health.active_provider.label} · {health.active_provider.model}
                      </strong>
                      <span>{health.healthy ? 'Responde correctamente' : 'Sin respuesta'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="notice">No hay ningún proveedor activo — agrega uno y actívalo.</div>
                )}
                <div className="actions">
                  <button type="button" className="btn btn-labeled" onClick={handleTest} disabled={testing}>
                    {testing ? 'Probando…' : '⚡ Probar el activo'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'notifications' && isAdmin && (
        <div className="panel">
          <div className="panel-head">
            <h3>Notificaciones por correo</h3>
            <span>{notificationSender ? 'Configurado' : 'Sin configurar'}</span>
          </div>
          <div className="panel-body">
            <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 16 }}>
              Cuando alguien comparte un expediente o un buzón, además del aviso dentro de la app se le puede enviar
              un correo real avisándole. Elige abajo cuál de los buzones ya conectados va a figurar como remitente de
              esos avisos — no se necesita ninguna cuenta ni configuración adicional. Quitar un acceso no envía
              correo, solo el compartirlo lo hace.
            </p>

            {loadingSender ? (
              <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>Cargando…</p>
            ) : notificationSender ? (
              <div className="summary" style={{ marginBottom: 18 }}>
                <div className="summary-icon">✉</div>
                <div>
                  <strong style={{ fontSize: 15 }}>{notificationSender.label}</strong>
                  <span>{notificationSender.email_address}</span>
                </div>
              </div>
            ) : (
              <div className="notice" style={{ marginBottom: 18 }}>
                Ningún buzón configurado — los avisos de compartición quedan solo dentro de la app.
              </div>
            )}

            <div className="field" style={{ maxWidth: 420 }}>
              <label htmlFor="notification-sender-select">Buzón remitente</label>
              <select
                id="notification-sender-select"
                value={pendingSenderId}
                disabled={savingSender}
                onChange={(e) => setPendingSenderId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Ninguno (solo aviso in-app)</option>
                {mailboxes?.map((m) => (
                  <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                    {m.label} — {m.email_address || 'sin correo'}
                  </option>
                ))}
              </select>
              <div className="actions mt-4">
                <button
                  type="button"
                  className="btn primary btn-labeled"
                  disabled={savingSender || pendingSenderId === (notificationSender?.mailbox_account_id ?? '')}
                  onClick={handleSaveNotificationSender}
                >
                  {savingSender ? 'Guardando…' : '✓ Guardar'}
                </button>
              </div>
            </div>

            <div className="actions mt-7">
              <button
                type="button"
                className="btn btn-labeled"
                disabled={!notificationSender || testingSender}
                onClick={handleTestNotificationSender}
              >
                {testingSender ? 'Enviando…' : '✉ Enviar prueba'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && isAdmin && (
        <div className="panel">
          <div className="panel-head">
            <h3>Usuarios</h3>
            <span>{users.length} cuenta(s)</span>
          </div>
          <div className="panel-body">
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
              Administra las cuentas con acceso a la aplicación — quién puede entrar, con qué rol, y su estado
              actual. Un usuario recién creado queda pendiente de su primer login: se activa solo cuando esa persona
              entra por primera vez con SSO Microsoft usando este mismo email.
            </p>

            {usersLoading ? (
              <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>Cargando…</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: 320 }}>Email</th>
                      <th scope="col" style={{ width: 220 }}>Nombre</th>
                      <th scope="col">Rol</th>
                      <th scope="col">Método</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Último login</th>
                      <th scope="col" style={{ width: 250 }} aria-label="Acciones"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={7} className="empty-view">
                          No hay ningún usuario registrado todavía.
                        </td>
                      </tr>
                    )}
                    {users.map((u) => (
                      <tr key={u.user_id}>
                        <td>{u.email_address}</td>
                        <td>{u.display_name || '—'}</td>
                        <td>{ROLE_LABELS[u.role] ?? u.role}</td>
                        <td>
                          <span className={`badge ${u.auth_method === 'local' ? 'queued' : 'success'}`}>
                            {u.auth_method === 'local' ? `Local (${u.username})` : 'SSO'}
                          </span>
                          {u.auth_method === 'local' && u.must_change_password && (
                            <span className="badge failed ml-2">
                              debe cambiar contraseña
                            </span>
                          )}
                        </td>
                        <td>{u.enabled ? 'Activo' : 'Desactivado'}</td>
                        <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Nunca'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <ActionButton icon={FileText} label="Ver ficha" onClick={() => setDetailUser(u)} />
                            <ActionButton icon={Pencil} label="Editar" onClick={() => openEditUserForm(u)} />
                            {u.auth_method === 'local' && (
                              <ActionButton
                                icon={KeyRound}
                                label="Resetear contraseña"
                                onClick={() => {
                                  setResetPasswordTarget(u)
                                  setResetPasswordValue('')
                                }}
                              />
                            )}
                            <ActionButton
                              icon={u.enabled ? Pause : Play}
                              label={u.enabled ? 'Desactivar' : 'Activar'}
                              variant={u.enabled ? 'danger' : 'default'}
                              onClick={() => setUserToggleTarget(u)}
                            />
                            <ActionButton
                              icon={Trash2}
                              label={u.user_id === user?.user_id ? 'No podés eliminar tu propia cuenta' : 'Eliminar'}
                              variant="danger"
                              disabled={u.user_id === user?.user_id}
                              onClick={() => openDeleteUserModal(u)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="actions mt-6">
              <button type="button" className="btn primary btn-labeled" onClick={openCreateUserForm}>
                ＋ Crear usuario
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`modal-backdrop${formOpen ? ' open' : ''}`}>
        <div className="modal compact">
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <h3>{editingId ? 'Editar proveedor' : 'Agregar proveedor'}</h3>
              <div className="form-grid mt-6">
                <div className="field">
                  <label htmlFor="provider-label">Nombre</label>
                  <input
                    id="provider-label"
                    type="text"
                    required
                    placeholder="ej. Ollama de la oficina"
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="provider-type">Tipo</label>
                  <select
                    id="provider-type"
                    value={form.provider_type}
                    onChange={(e) => setProviderType(e.target.value as AIProviderType)}
                  >
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Claude (Anthropic)</option>
                  </select>
                </div>
                {form.provider_type === 'ollama' && (
                  <div className="field full">
                    <label htmlFor="provider-base-url">URL del servidor</label>
                    <input
                      id="provider-base-url"
                      type="text"
                      required
                      placeholder="ej. http://192.168.1.50:11434"
                      value={form.base_url}
                      onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    />
                  </div>
                )}
                {form.provider_type === 'ollama' && (
                  <div className="field full">
                    <label htmlFor="provider-num-ctx">Tamaño de contexto (num_ctx)</label>
                    <select
                      id="provider-num-ctx"
                      value={form.num_ctx}
                      onChange={(e) => setForm((f) => ({ ...f, num_ctx: Number(e.target.value) }))}
                    >
                      {NUM_CTX_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n.toLocaleString('es-CL')} tokens
                        </option>
                      ))}
                    </select>
                    <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                      Cuánto contenido de un expediente puede ver el modelo por consulta. Valores más altos usan más
                      memoria en el servidor Ollama — se aplica en la siguiente consulta, sin reiniciar nada.
                    </p>
                  </div>
                )}
                {form.provider_type === 'ollama' && (
                  <div className="field full">
                    <label htmlFor="provider-embeddings-model">Modelo de embeddings</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        id="provider-embeddings-model"
                        type="text"
                        autoComplete="off"
                        list={
                          fetchedEmbeddingModels && fetchedEmbeddingModels.length > 0
                            ? 'provider-embeddings-model-options'
                            : undefined
                        }
                        placeholder="ej. bge-m3"
                        value={form.embeddings_model}
                        onChange={(e) => setForm((f) => ({ ...f, embeddings_model: e.target.value }))}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn small btn-labeled"
                        onClick={handleFetchEmbeddingModels}
                        disabled={fetchingEmbeddingModels || !form.base_url.trim()}
                      >
                        {fetchingEmbeddingModels ? 'Buscando…' : '⟳ Recuperar modelos'}
                      </button>
                    </div>
                    {fetchedEmbeddingModels && fetchedEmbeddingModels.length > 0 && (
                      <>
                        <datalist id="provider-embeddings-model-options">
                          {fetchedEmbeddingModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </datalist>
                        <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                          {fetchedEmbeddingModels.length} modelo(s) con capacidad de embeddings en este servidor.
                        </p>
                      </>
                    )}
                    <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                      Solo se usa si activás el rol "Embeddings" para este proveedor (búsqueda semántica en
                      expedientes grandes) — independiente del modelo de chat de arriba.
                    </p>
                  </div>
                )}
                {form.provider_type !== 'ollama' && (
                  <div className="field full">
                    <label htmlFor="provider-api-key">
                      API key {editingId ? '(dejar vacío para mantener la actual)' : ''}
                    </label>
                    <input
                      id="provider-api-key"
                      type="password"
                      autoComplete="off"
                      placeholder={editingId ? '••••••••' : 'sk-...'}
                      value={form.api_key}
                      onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    />
                  </div>
                )}
                <div className="field full">
                  <label htmlFor="provider-model">Modelo</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="provider-model"
                      type="text"
                      required
                      autoComplete="off"
                      list={fetchedModels && fetchedModels.length > 0 ? 'provider-model-options' : undefined}
                      placeholder={MODEL_PLACEHOLDER[form.provider_type]}
                      value={form.model}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn small btn-labeled"
                      onClick={handleFetchModels}
                      disabled={fetchingModels || (form.provider_type === 'ollama' ? !form.base_url.trim() : false)}
                    >
                      {fetchingModels ? 'Buscando…' : '⟳ Recuperar modelos'}
                    </button>
                  </div>
                  {fetchedModels && fetchedModels.length > 0 && (
                    <>
                      <datalist id="provider-model-options">
                        {fetchedModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </datalist>
                      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                        {fetchedModels.length} modelo(s) real(es) del proveedor — escribe para acotar la lista.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-labeled" onClick={closeForm}>
                ✕ Cancelar
              </button>
              <button type="submit" className="btn primary btn-labeled" disabled={saving}>
                {saving ? 'Guardando…' : editingId ? '✓ Guardar cambios' : '＋ Agregar proveedor'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className={`modal-backdrop${connectModalOpen ? ' open' : ''}`}>
        <div className="modal narrow">
          <div className="modal-body">
            <h3>Conectar cuenta nueva</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
              Pon un nombre a la cuenta (así la distingues en la lista) y confirma para abrir el login real de
              Microsoft en una ventana aparte — Microsoft no permite mostrar su login dentro de esta página. La
              ventana se cierra sola al terminar y esta lista se actualiza automáticamente.
            </p>
            <div className="form-grid mt-6">
              <div className="field full">
                <label htmlFor="mailbox-label">Nombre de la cuenta</label>
                <input
                  id="mailbox-label"
                  type="text"
                  placeholder='ej. "Mesa" o "Agente Juan Pérez"'
                  value={newMailboxLabel}
                  onChange={(e) => setNewMailboxLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnectMailbox()}
                />
              </div>
              <div className="field full">
                <label htmlFor="mailbox-tenant">Tenant de Microsoft</label>
                <select
                  id="mailbox-tenant"
                  value={selectedTenantConfigId}
                  onChange={(e) => setSelectedTenantConfigId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Selecciona un tenant…</option>
                  {tenants?.filter((t) => t.is_active).map((t) => (
                    <option key={t.tenant_config_id} value={t.tenant_config_id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {tenants !== null && tenants.filter((t) => t.is_active).length === 0 && (
                  <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                    No hay ningún tenant activo — agrega uno arriba antes de conectar una cuenta.
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-labeled" onClick={() => setConnectModalOpen(false)}>
              ✕ Cancelar
            </button>
            <button type="button" className="btn primary btn-labeled" disabled={connecting} onClick={handleConnectMailbox}>
              {connecting ? 'Abriendo…' : '➜ Conectar'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-backdrop${tenantFormOpen ? ' open' : ''}`}>
        <div className="modal narrow">
          <form onSubmit={handleTenantSubmit}>
            <div className="modal-body">
              <h3>{editingTenantId ? 'Editar tenant' : 'Agregar tenant'}</h3>
              <div className="form-grid mt-6">
                <div className="field full">
                  <label htmlFor="tenant-label">Nombre</label>
                  <input
                    id="tenant-label"
                    type="text"
                    required
                    placeholder="ej. Cliente XYZ"
                    value={tenantForm.label}
                    onChange={(e) => setTenantForm((f) => ({ ...f, label: e.target.value }))}
                  />
                </div>
                <div className="field full">
                  <label htmlFor="tenant-ms-id">Tenant ID (Azure AD)</label>
                  <input
                    id="tenant-ms-id"
                    type="text"
                    required
                    autoComplete="off"
                    placeholder="ej. 11111111-2222-3333-4444-555555555555"
                    value={tenantForm.ms_tenant_id}
                    onChange={(e) => setTenantForm((f) => ({ ...f, ms_tenant_id: e.target.value }))}
                  />
                </div>
                <div className="field full">
                  <label htmlFor="tenant-client-id">Client ID (App Registration)</label>
                  <input
                    id="tenant-client-id"
                    type="text"
                    required
                    autoComplete="off"
                    value={tenantForm.ms_client_id}
                    onChange={(e) => setTenantForm((f) => ({ ...f, ms_client_id: e.target.value }))}
                  />
                </div>
                <div className="field full">
                  <label htmlFor="tenant-client-secret">
                    Client secret {editingTenantId ? '(dejar vacío para mantener el actual)' : ''}
                  </label>
                  <input
                    id="tenant-client-secret"
                    type="password"
                    autoComplete="off"
                    placeholder={editingTenantId ? '••••••••' : ''}
                    required={!editingTenantId}
                    value={tenantForm.ms_client_secret}
                    onChange={(e) => setTenantForm((f) => ({ ...f, ms_client_secret: e.target.value }))}
                  />
                </div>
                <div className="field full">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={tenantForm.is_active}
                      onChange={(e) => setTenantForm((f) => ({ ...f, is_active: e.target.checked }))}
                    />
                    Activo (disponible para conectar buzones nuevos)
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-labeled" onClick={closeTenantForm}>
                ✕ Cancelar
              </button>
              <button type="submit" className="btn primary btn-labeled" disabled={savingTenant}>
                {savingTenant ? 'Guardando…' : editingTenantId ? '✓ Guardar cambios' : '＋ Agregar tenant'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmModal
        open={deleteTenantTarget !== null}
        title="Eliminar tenant"
        description={
          deleteTenantTarget
            ? `Se elimina "${deleteTenantTarget.label}" de la lista de tenants registrados. Los buzones ya conectados con él siguen funcionando (guardan sus propias credenciales) — solo deja de estar disponible para conectar cuentas nuevas.`
            : ''
        }
        confirmLabel="Eliminar tenant"
        confirmingLabel="Eliminando…"
        confirming={deletingTenant}
        onCancel={() => setDeleteTenantTarget(null)}
        onConfirm={handleDeleteTenant}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title="Eliminar proveedor"
        description={
          deleteTarget
            ? (() => {
                const roles = [
                  deleteTarget.is_chat_active ? 'consultas' : null,
                  deleteTarget.is_embeddings_active ? 'embeddings' : null,
                ].filter(Boolean)
                const warning =
                  roles.length > 0
                    ? ` — está en uso para ${roles.join(' y ')}, esa función dejará de funcionar hasta que actives otro proveedor`
                    : ''
                return `Se elimina "${deleteTarget.label}" de la lista${warning}.`
              })()
            : ''
        }
        confirmLabel="Eliminar proveedor"
        confirmingLabel="Eliminando…"
        confirming={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      <ConfirmModal
        open={deleteMailboxTarget !== null}
        title="Eliminar cuenta de buzón"
        description={
          deleteMailboxTarget
            ? `Se elimina "${deleteMailboxTarget.label}" (${deleteMailboxTarget.email_address || 'sin correo registrado'}) y TODO su contenido indexado localmente: correos, expedientes armados solo con esos correos, y sus adjuntos. Un expediente que además tenga correos de otro buzón no se borra, pero queda una nota señalando que esos correos ya no están disponibles. Esta acción es solo local — nunca borra ni modifica nada en el buzón real de Microsoft 365 — pero no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar cuenta"
        confirmingLabel={deletingMailbox ? 'Eliminando…' : 'Calculando impacto…'}
        confirming={deletingMailbox || loadingDeleteMailboxImpact}
        onCancel={() => {
          setDeleteMailboxTarget(null)
          setDeleteMailboxImpact(null)
        }}
        onConfirm={handleDeleteMailbox}
      >
        {loadingDeleteMailboxImpact && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Calculando impacto…</p>}
        {!loadingDeleteMailboxImpact && deleteMailboxImpact && (
          <p style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            Se borrarán {deleteMailboxImpact.message_count} correo(s) y {deleteMailboxImpact.cases_deleted}{' '}
            expediente(s) completo(s)
            {deleteMailboxImpact.cases_affected > 0 &&
              `; otros ${deleteMailboxImpact.cases_affected} expediente(s) quedarán con una nota de correo no disponible`}
            .
          </p>
        )}
      </ConfirmModal>

      <ShareModal
        open={shareMailboxTarget !== null}
        title={shareMailboxTarget ? `Compartir "${shareMailboxTarget.label}"` : 'Compartir buzón'}
        description="La persona podrá ver los mensajes de este buzón (solo lectura), sin poder editarlo ni eliminarlo."
        allowEditPermission={false}
        existingShares={mailboxShares}
        saving={sharingMailbox}
        onConfirm={handleConfirmMailboxShares}
        onClose={() => setShareMailboxTarget(null)}
      />

      <UserFormModal
        open={userFormOpen}
        mode={userFormMode}
        user={editingUserTarget}
        saving={savingUserForm}
        onSubmit={handleUserFormSubmit}
        onClose={() => setUserFormOpen(false)}
      />

      <ConfirmModal
        open={userToggleTarget !== null}
        title={userToggleTarget?.enabled ? 'Desactivar usuario' : 'Activar usuario'}
        description={
          userToggleTarget
            ? userToggleTarget.enabled
              ? `Se desactiva a "${userToggleTarget.display_name || userToggleTarget.email_address}" y se cierran todas sus sesiones activas de inmediato. No pierde sus expedientes ni buzones, solo el acceso hasta que se lo reactive.`
              : `Se reactiva a "${userToggleTarget.display_name || userToggleTarget.email_address}" — vuelve a poder iniciar sesión normalmente.`
            : ''
        }
        confirmLabel={userToggleTarget?.enabled ? 'Desactivar' : 'Activar'}
        confirmingLabel={userToggleTarget?.enabled ? 'Desactivando…' : 'Activando…'}
        confirmIcon={userToggleTarget?.enabled ? '⏸' : '▶'}
        confirmDanger={!!userToggleTarget?.enabled}
        confirming={togglingUser}
        onCancel={() => setUserToggleTarget(null)}
        onConfirm={handleConfirmToggleUser}
      />

      <ConfirmModal
        open={resetPasswordTarget !== null}
        title="Resetear contraseña"
        description={
          resetPasswordTarget
            ? `Se fija una contraseña nueva para "${resetPasswordTarget.display_name || resetPasswordTarget.username}". Se cierran todas sus sesiones activas y va a tener que cambiarla de nuevo en su próximo login.`
            : ''
        }
        confirmLabel="Resetear"
        confirmingLabel="Reseteando…"
        confirmIcon="🔑"
        confirmDanger={false}
        confirming={resettingPassword}
        onCancel={() => {
          setResetPasswordTarget(null)
          setResetPasswordValue('')
        }}
        onConfirm={handleResetPassword}
      >
        <div className="field full mt-4">
          <label htmlFor="reset-password-value">Contraseña temporal nueva</label>
          <input
            id="reset-password-value"
            type="text"
            minLength={8}
            placeholder="mínimo 8 caracteres"
            value={resetPasswordValue}
            onChange={(e) => setResetPasswordValue(e.target.value)}
          />
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={deleteUserTarget !== null}
        title="Eliminar usuario"
        description={
          deleteUserTarget
            ? `Se elimina la cuenta de "${deleteUserTarget.display_name || deleteUserTarget.email_address}" — no se puede deshacer. No se borra ningún expediente ni correo indexado.`
            : ''
        }
        confirmLabel="Eliminar cuenta"
        confirmingLabel={deletingUser ? 'Eliminando…' : 'Calculando impacto…'}
        confirming={deletingUser || loadingDeleteUserImpact}
        onCancel={() => {
          setDeleteUserTarget(null)
          setDeleteUserImpact(null)
        }}
        onConfirm={handleDeleteUser}
      >
        {loadingDeleteUserImpact && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Calculando impacto…</p>}
        {!loadingDeleteUserImpact && deleteUserImpact && (
          <p style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            {deleteUserImpact.cases_owned > 0
              ? `${deleteUserImpact.cases_owned} expediente(s) de esta persona quedarán a tu nombre, con una nota indicando quién era el dueño original — se puede reasignar después desde Expedientes.`
              : 'No es dueño de ningún expediente — no hay nada que reasignar.'}
          </p>
        )}
      </ConfirmModal>

      <UserDetailModal open={detailUser !== null} user={detailUser} onClose={() => setDetailUser(null)} />

      <ConfirmModal
        open={clearMailboxIndexModalOpen}
        title="Limpiar historial de indexación"
        description="Esta acción elimina los registros de corridas terminadas (completas, parciales, fallidas o canceladas). Los correos ya indexados en el buzón no se ven afectados, solo el historial de progreso."
        confirmLabel="Confirmar limpieza"
        confirmingLabel="Limpiando…"
        confirming={clearingMailboxIndexHistory}
        onCancel={() => setClearMailboxIndexModalOpen(false)}
        onConfirm={handleClearMailboxIndexHistory}
      />
    </section>
  )
}
