import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  activateAIProvider,
  claimMailbox,
  createAIProvider,
  createUser,
  deleteAIProvider,
  deleteMailbox,
  getAIHealth,
  getAIPolicy,
  getMailboxConnectUrl,
  getNotificationSender,
  listAIProviderModels,
  listAIProviders,
  listMailboxes,
  listMailboxShares,
  listUserDirectory,
  listUsers,
  revokeMailboxShare,
  setNotificationSender,
  shareMailbox,
  testAIProvider,
  testMailbox,
  testNotificationSender,
  updateAIPolicy,
  updateAIProvider,
  updateMailbox,
  updateUser,
} from '../api/client'
import type { AIHealthResponse, AIPolicy, AIProviderRead, AIProviderType } from '../types/ai'
import { AI_POLICY_LABELS, AI_PROVIDER_TYPE_LABELS, isLocalProviderType } from '../types/ai'
import type { MailboxAccountRead, MailboxShareRead } from '../types/mailboxes'
import type { UserDirectoryEntry, UserRead } from '../types/users'
import { ConfirmModal } from '../components/ConfirmModal'
import { ShareModal } from '../components/ShareModal'
import { UserDetailModal } from '../components/UserDetailModal'
import { UserFormModal, type UserFormValues } from '../components/UserFormModal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useBodyScrollLock } from '../utils/modalScrollLock'

interface ProviderFormState {
  label: string
  provider_type: AIProviderType
  base_url: string
  model: string
  api_key: string
}

const EMPTY_FORM: ProviderFormState = {
  label: '',
  provider_type: 'ollama',
  base_url: '',
  model: '',
  api_key: '',
}

const MODEL_PLACEHOLDER: Record<AIProviderType, string> = {
  ollama: 'ej. qwen2.5:3b',
  openai: 'ej. gpt-4o-mini',
  anthropic: 'ej. claude-3-5-sonnet-20241022',
}

type SettingsTab = 'mailboxes' | 'ai' | 'notifications' | 'users'

const TAB_LABELS: Record<SettingsTab, string> = {
  mailboxes: 'Buzones',
  ai: 'Inteligencia artificial',
  notifications: 'Notificaciones',
  users: 'Usuarios',
}

const ROLE_LABELS: Record<string, string> = {
  user: 'Usuario',
  admin: 'Admin',
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
  const [activatingId, setActivatingId] = useState<number | null>(null)
  const [testingProviderId, setTestingProviderId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIProviderRead | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)

  const [mailboxes, setMailboxes] = useState<MailboxAccountRead[] | null>(null)
  const [mailboxError, setMailboxError] = useState<string | null>(null)
  const [userDirectory, setUserDirectory] = useState<UserDirectoryEntry[]>([])
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [newMailboxLabel, setNewMailboxLabel] = useState('')
  useBodyScrollLock(formOpen || connectModalOpen)
  const [connecting, setConnecting] = useState(false)
  const [togglingMailboxId, setTogglingMailboxId] = useState<number | null>(null)
  const [claimingMailboxId, setClaimingMailboxId] = useState<number | null>(null)
  const [testingMailboxId, setTestingMailboxId] = useState<number | null>(null)
  const [deleteMailboxTarget, setDeleteMailboxTarget] = useState<MailboxAccountRead | null>(null)
  const [deletingMailbox, setDeletingMailbox] = useState(false)
  const [shareMailboxTarget, setShareMailboxTarget] = useState<MailboxAccountRead | null>(null)
  const [mailboxShares, setMailboxShares] = useState<MailboxShareRead[]>([])
  const [sharingMailbox, setSharingMailbox] = useState(false)
  const [revokingMailboxShareUserId, setRevokingMailboxShareUserId] = useState<number | null>(null)

  const [users, setUsers] = useState<UserRead[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [detailUser, setDetailUser] = useState<UserRead | null>(null)
  const [userFormOpen, setUserFormOpen] = useState(false)
  const [userFormMode, setUserFormMode] = useState<'create' | 'edit'>('create')
  const [editingUserTarget, setEditingUserTarget] = useState<UserRead | null>(null)
  const [savingUserForm, setSavingUserForm] = useState(false)
  const [userToggleTarget, setUserToggleTarget] = useState<UserRead | null>(null)
  const [togglingUser, setTogglingUser] = useState(false)

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
    }
    loadMailboxes()
    loadUserDirectory()
    function onFocus() {
      loadMailboxes()
    }
    function onMessage(event: MessageEvent) {
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
    setFormOpen(true)
  }

  function openEditForm(provider: AIProviderRead) {
    setEditingId(provider.provider_id)
    setForm({
      label: provider.label,
      provider_type: provider.provider_type,
      base_url: provider.base_url ?? '',
      model: provider.model,
      api_key: '',
    })
    setFetchedModels(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setFetchedModels(null)
  }

  function setProviderType(next: AIProviderType) {
    setForm((f) => ({ ...f, provider_type: next }))
    setFetchedModels(null)
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        label: form.label.trim(),
        provider_type: form.provider_type,
        base_url: form.base_url.trim() || null,
        model: form.model.trim(),
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

  async function handleActivate(providerId: number) {
    setActivatingId(providerId)
    try {
      await activateAIProvider(providerId)
      showToast('Proveedor activado')
      await loadAll()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo activar el proveedor.', true)
    } finally {
      setActivatingId(null)
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

  function openConnectModal() {
    setNewMailboxLabel('')
    setConnectModalOpen(true)
  }

  async function handleConnectMailbox() {
    const label = newMailboxLabel.trim()
    if (!label) {
      showToast('Escribe un nombre para la cuenta antes de conectarla (ej. "Mesa", "Agente Juan").', true)
      return
    }
    setConnecting(true)
    try {
      const { url } = await getMailboxConnectUrl(label)
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

  async function openShareMailboxModal(mailbox: MailboxAccountRead) {
    setShareMailboxTarget(mailbox)
    try {
      setMailboxShares(await listMailboxShares(mailbox.mailbox_account_id))
    } catch (err) {
      setMailboxShares([])
      showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar las comparticiones.', true)
    }
  }

  async function handleShareMailboxConfirm(userId: number) {
    if (!shareMailboxTarget) return
    setSharingMailbox(true)
    try {
      await shareMailbox(shareMailboxTarget.mailbox_account_id, userId, 'read')
      showToast('Buzón compartido.')
      setMailboxShares(await listMailboxShares(shareMailboxTarget.mailbox_account_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo compartir el buzón.', true)
    } finally {
      setSharingMailbox(false)
    }
  }

  async function handleRevokeMailboxShare(userId: number) {
    if (!shareMailboxTarget) return
    setRevokingMailboxShareUserId(userId)
    try {
      const result = await revokeMailboxShare(shareMailboxTarget.mailbox_account_id, userId)
      showToast(
        result.cases_affected > 0
          ? `Acceso revocado. También se le quitó el acceso a ${result.cases_affected} expediente(s) relacionado(s).`
          : 'Acceso revocado.',
      )
      setMailboxShares(await listMailboxShares(shareMailboxTarget.mailbox_account_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo revocar el acceso.', true)
    } finally {
      setRevokingMailboxShareUserId(null)
    }
  }

  async function handleDeleteMailbox() {
    if (!deleteMailboxTarget) return
    setDeletingMailbox(true)
    try {
      await deleteMailbox(deleteMailboxTarget.mailbox_account_id)
      showToast('Cuenta eliminada')
      setDeleteMailboxTarget(null)
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
        })
        showToast('Usuario creado. Queda pendiente de su primer login.')
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

  const visibleTabs: SettingsTab[] = isAdmin ? ['mailboxes', 'ai', 'notifications', 'users'] : ['mailboxes']

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

      {tab === 'mailboxes' && (
        <div className="panel">
          <div className="panel-head">
            <h3>Buzones</h3>
            <span>{mailboxes?.length ?? 0} cuenta(s) accesible(s)</span>
          </div>
          <div className="panel-body">
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
              Cada cuenta conectada queda disponible para correr trabajos contra ese buzón — el buzón de mesa y los
              de los agentes pueden convivir al mismo tiempo. Conectar una cuenta abre el login real de Microsoft
              en una ventana aparte; al volver, esta lista se actualiza sola.
            </p>

            {mailboxError && <p className="form-error">{mailboxError}</p>}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 140 }}></th>
                    <th>Buzón</th>
                    <th>Dueño</th>
                    <th style={{ width: 250 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {mailboxes !== null && mailboxes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty-view">
                        No hay ninguna cuenta de buzón conectada todavía (o accesible para ti).
                      </td>
                    </tr>
                  )}
                  {mailboxes?.map((m) => {
                    const canManage = isAdmin || m.owner_user_id === user?.user_id
                    return (
                      <tr key={m.mailbox_account_id}>
                        <td>
                          <span className={`badge ${m.enabled ? 'success' : ''}`}>
                            {m.enabled ? 'Habilitada' : 'Deshabilitada'}
                          </span>
                        </td>
                        <td>
                          <div>{m.label}</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {m.email_address || '—'}
                          </div>
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {ownerLabel(m.owner_user_id)}
                          {m.is_notification_sender && (
                            <span className="badge success" style={{ marginLeft: 6 }}>
                              notificaciones
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn small primary icon-btn"
                              disabled={testingMailboxId === m.mailbox_account_id}
                              data-tooltip="Probar conexión"
                              aria-label="Probar conexión"
                              onClick={() => handleTestMailbox(m)}
                            >
                              {testingMailboxId === m.mailbox_account_id ? '…' : '⚡'}
                            </button>
                            {m.owner_user_id === null && (
                              <button
                                type="button"
                                className="btn small primary icon-btn"
                                disabled={claimingMailboxId === m.mailbox_account_id}
                                data-tooltip="Reclamar"
                                aria-label="Reclamar"
                                onClick={() => handleClaimMailbox(m)}
                              >
                                {claimingMailboxId === m.mailbox_account_id ? '…' : '⚑'}
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="btn small icon-btn"
                                data-tooltip="Compartir"
                                aria-label="Compartir"
                                onClick={() => openShareMailboxModal(m)}
                              >
                                🔗
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="btn small icon-btn"
                                disabled={togglingMailboxId === m.mailbox_account_id}
                                data-tooltip={m.enabled ? 'Deshabilitar' : 'Habilitar'}
                                aria-label={m.enabled ? 'Deshabilitar' : 'Habilitar'}
                                onClick={() => handleToggleMailboxEnabled(m)}
                              >
                                {togglingMailboxId === m.mailbox_account_id ? '…' : m.enabled ? '⏸' : '▶'}
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="btn small danger icon-btn"
                                data-tooltip="Eliminar"
                                aria-label="Eliminar"
                                onClick={() => setDeleteMailboxTarget(m)}
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn primary btn-labeled" onClick={openConnectModal}>
                ＋ Conectar cuenta nueva
              </button>
              <button type="button" className="btn btn-labeled" onClick={loadMailboxes}>
                ↻ Actualizar lista
              </button>
            </div>
          </div>
        </div>
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
                        <th style={{ width: 120 }}></th>
                        <th>Nombre</th>
                        <th style={{ width: 190 }}>Tipo</th>
                        <th>Modelo</th>
                        <th>Servidor / API key</th>
                        <th style={{ width: 210 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {providers !== null && providers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="empty-view">
                            No hay proveedores configurados todavía.
                          </td>
                        </tr>
                      )}
                      {providers?.map((p) => (
                        <tr key={p.provider_id}>
                          <td>{p.is_active ? <span className="badge success">Activo</span> : null}</td>
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
                          <td className="mono">{p.model}</td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {p.provider_type === 'ollama' ? p.base_url || '—' : p.has_api_key ? 'API key guardada' : 'sin API key'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn small icon-btn"
                                disabled={testingProviderId === p.provider_id}
                                data-tooltip="Probar"
                                aria-label="Probar"
                                onClick={() => handleTestProvider(p)}
                              >
                                {testingProviderId === p.provider_id ? '…' : '⚡'}
                              </button>
                              {!p.is_active && (
                                <button
                                  type="button"
                                  className="btn small primary icon-btn"
                                  disabled={
                                    activatingId === p.provider_id ||
                                    (policy === 'local_only' && !isLocalProviderType(p.provider_type))
                                  }
                                  data-tooltip={
                                    policy === 'local_only' && !isLocalProviderType(p.provider_type)
                                      ? "Bloqueado por la política 'Solo local'"
                                      : 'Activar'
                                  }
                                  aria-label="Activar"
                                  onClick={() => handleActivate(p.provider_id)}
                                >
                                  {activatingId === p.provider_id ? '…' : '▶'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn small icon-btn"
                                data-tooltip="Editar"
                                aria-label="Editar"
                                onClick={() => openEditForm(p)}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="btn small danger icon-btn"
                                data-tooltip="Eliminar"
                                aria-label="Eliminar"
                                onClick={() => setDeleteTarget(p)}
                              >
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="actions" style={{ marginTop: 14 }}>
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
                  <div className="actions" style={{ marginTop: 10 }}>
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
              <div className="actions" style={{ marginTop: 10 }}>
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

            <div className="actions" style={{ marginTop: 16 }}>
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
                      <th style={{ width: 320 }}>Email</th>
                      <th style={{ width: 220 }}>Nombre</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Último login</th>
                      <th style={{ width: 160 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-view">
                          No hay ningún usuario registrado todavía.
                        </td>
                      </tr>
                    )}
                    {users.map((u) => (
                      <tr key={u.user_id}>
                        <td>{u.email_address}</td>
                        <td>{u.display_name || '—'}</td>
                        <td>{ROLE_LABELS[u.role] ?? u.role}</td>
                        <td>{u.enabled ? 'Activo' : 'Desactivado'}</td>
                        <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Nunca'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn small icon-btn"
                              data-tooltip="Ver ficha"
                              aria-label="Ver ficha"
                              onClick={() => setDetailUser(u)}
                            >
                              🧾
                            </button>
                            <button
                              type="button"
                              className="btn small icon-btn"
                              data-tooltip="Editar"
                              aria-label="Editar"
                              onClick={() => openEditUserForm(u)}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className={`btn small icon-btn${u.enabled ? ' danger' : ''}`}
                              data-tooltip={u.enabled ? 'Desactivar' : 'Activar'}
                              aria-label={u.enabled ? 'Desactivar' : 'Activar'}
                              onClick={() => setUserToggleTarget(u)}
                            >
                              {u.enabled ? '⏸' : '▶'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn primary btn-labeled" onClick={openCreateUserForm}>
                ＋ Crear usuario
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`modal-backdrop${formOpen ? ' open' : ''}`}>
        <div className="modal" style={{ width: 'min(560px, 95vw)' }}>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <h3>{editingId ? 'Editar proveedor' : 'Agregar proveedor'}</h3>
              <div className="form-grid" style={{ marginTop: 14 }}>
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
                          <option key={m} value={m} />
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
        <div className="modal" style={{ width: 'min(480px, 95vw)' }}>
          <div className="modal-body">
            <h3>Conectar cuenta nueva</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
              Pon un nombre a la cuenta (así la distingues en la lista) y confirma para abrir el login real de
              Microsoft en una ventana aparte — Microsoft no permite mostrar su login dentro de esta página. La
              ventana se cierra sola al terminar y esta lista se actualiza automáticamente.
            </p>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field full">
                <label htmlFor="mailbox-label">Nombre de la cuenta</label>
                <input
                  id="mailbox-label"
                  type="text"
                  autoFocus
                  placeholder='ej. "Mesa" o "Agente Juan Pérez"'
                  value={newMailboxLabel}
                  onChange={(e) => setNewMailboxLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnectMailbox()}
                />
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

      <ConfirmModal
        open={deleteTarget !== null}
        title="Eliminar proveedor"
        description={
          deleteTarget
            ? `Se elimina "${deleteTarget.label}" de la lista${deleteTarget.is_active ? ' — es el proveedor activo, ningún análisis de IA funcionará hasta que actives otro' : ''}.`
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
            ? `Se elimina "${deleteMailboxTarget.label}" (${deleteMailboxTarget.email_address || 'sin correo registrado'}). Los trabajos que ya corrieron contra este buzón no se ven afectados, pero no se podrán crear trabajos nuevos contra esta cuenta hasta reconectarla.`
            : ''
        }
        confirmLabel="Eliminar cuenta"
        confirmingLabel="Eliminando…"
        confirming={deletingMailbox}
        onCancel={() => setDeleteMailboxTarget(null)}
        onConfirm={handleDeleteMailbox}
      />

      <ShareModal
        open={shareMailboxTarget !== null}
        title={shareMailboxTarget ? `Compartir "${shareMailboxTarget.label}"` : 'Compartir buzón'}
        description="La persona podrá ver los mensajes de este buzón (solo lectura), sin poder editarlo ni eliminarlo."
        allowEditPermission={false}
        existingShares={mailboxShares}
        sharing={sharingMailbox}
        revokingUserId={revokingMailboxShareUserId}
        onShare={(userId) => handleShareMailboxConfirm(userId)}
        onRevoke={handleRevokeMailboxShare}
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

      <UserDetailModal open={detailUser !== null} user={detailUser} onClose={() => setDetailUser(null)} />
    </section>
  )
}
