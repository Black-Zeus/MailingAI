import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  activateAIProvider,
  createAIProvider,
  deleteAIProvider,
  deleteMailbox,
  getAIHealth,
  getAIPolicy,
  getMailboxConnectUrl,
  listAIProviderModels,
  listAIProviders,
  listMailboxes,
  testMailbox,
  updateAIPolicy,
  updateAIProvider,
  updateMailbox,
} from '../api/client'
import type { AIHealthResponse, AIPolicy, AIProviderRead, AIProviderType } from '../types/ai'
import { AI_POLICY_LABELS, AI_PROVIDER_TYPE_LABELS } from '../types/ai'
import type { MailboxAccountRead } from '../types/mailboxes'
import { MAILBOX_PROVIDER_LABELS } from '../types/mailboxes'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../context/ToastContext'
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

export function SettingsView() {
  const { showToast } = useToast()
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
  const [deleteTarget, setDeleteTarget] = useState<AIProviderRead | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)

  const [mailboxes, setMailboxes] = useState<MailboxAccountRead[] | null>(null)
  const [mailboxError, setMailboxError] = useState<string | null>(null)
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [newMailboxLabel, setNewMailboxLabel] = useState('')
  useBodyScrollLock(formOpen || connectModalOpen)
  const [connecting, setConnecting] = useState(false)
  const [togglingMailboxId, setTogglingMailboxId] = useState<number | null>(null)
  const [testingMailboxId, setTestingMailboxId] = useState<number | null>(null)
  const [deleteMailboxTarget, setDeleteMailboxTarget] = useState<MailboxAccountRead | null>(null)
  const [deletingMailbox, setDeletingMailbox] = useState(false)

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

  useEffect(() => {
    loadAll()
    loadMailboxes()
    function onFocus() {
      loadMailboxes()
    }
    function onMessage(event: MessageEvent) {
      if (event.data?.type !== 'mailingai-mailbox-connected') return
      setConnectModalOpen(false)
      setNewMailboxLabel('')
      showToast(`Cuenta conectada: ${event.data.email_address}`)
      loadMailboxes()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('message', onMessage)
    }
  }, [])

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

  async function handlePolicyChange(next: AIPolicy) {
    setSavingPolicy(true)
    try {
      const result = await updateAIPolicy(next)
      setPolicy(result.policy)
      showToast('Política de IA actualizada')
      await loadAll()
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

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Configuración</h2>
          <p>
            Administrá los proveedores de IA (Ollama en esta u otra máquina de tu red, OpenAI, Claude) y cuál está
            activo. Solo puede haber un proveedor activo a la vez — el análisis de expedientes siempre usa ese.
          </p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Motor de inteligencia artificial</h3>
            <span>Estado en vivo</span>
          </div>
          <div className="panel-body summary-stack">
            <div className="summary">
              <div className="summary-icon">⛨</div>
              <div>
                <strong style={{ fontSize: 15 }}>{policy ? AI_POLICY_LABELS[policy] : '—'}</strong>
                <span>Política actual</span>
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
              <div className="notice">No hay ningún proveedor activo — agregá uno abajo y activalo.</div>
            )}
            <div className="actions">
              <button type="button" className="btn primary" onClick={handleTest} disabled={testing}>
                {testing ? 'Probando…' : 'Probar conexión'}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Controles</h3>
            <span>Arquitectura</span>
          </div>
          <div className="panel-body summary-stack">
            <div className="summary">
              <div className="summary-icon">✉</div>
              <div>
                <strong style={{ fontSize: 15 }}>Microsoft Graph</strong>
                <span>OAuth2 delegado por cuenta, administrado por el identity-broker</span>
              </div>
            </div>
            <div className="summary">
              <div className="summary-icon">⌘</div>
              <div>
                <strong style={{ fontSize: 15 }}>Solo lectura</strong>
                <span>Mail.Read delegado — este proyecto nunca envía ni modifica correos</span>
              </div>
            </div>
            <div className="summary">
              <div className="summary-icon">⛨</div>
              <div>
                <strong style={{ fontSize: 15 }}>Contenido reducido a la IA</strong>
                <span>Asunto, remitente real y vista previa acotada — nunca el cuerpo completo ni adjuntos</span>
              </div>
            </div>
            <div className="notice">
              Las cuentas de buzón conectadas (mesa, agentes) se administran en el panel "Buzones" más abajo. Para
              verificar que un buzón trae mensajes reales, crea un trabajo desde "Nueva consulta" y revisa su
              resultado en "Trabajos".
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Proveedores de IA</h3>
          <span>{providers?.length ?? 0} configurado(s)</span>
        </div>
        <div className="panel-body">
          <div className="field" style={{ maxWidth: 420, marginBottom: 18 }}>
            <label htmlFor="ai-policy">Política</label>
            <select
              id="ai-policy"
              value={policy ?? 'local_only'}
              disabled={savingPolicy}
              onChange={(e) => handlePolicyChange(e.target.value as AIPolicy)}
            >
              <option value="local_only">{AI_POLICY_LABELS.local_only}</option>
              <option value="allow_external">{AI_POLICY_LABELS.allow_external}</option>
            </select>
            <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
              "Solo local" bloquea OpenAI/Claude antes de llamarlos, aunque estén activos — el contenido de los
              correos nunca sale de tu red. Cambialo a "Permitir proveedores externos" recién cuando quieras probar
              uno de verdad.
            </p>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Modelo</th>
                  <th>Servidor / API key</th>
                  <th></th>
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
                    <td>{AI_PROVIDER_TYPE_LABELS[p.provider_type]}</td>
                    <td className="mono">{p.model}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {p.provider_type === 'ollama' ? p.base_url || '—' : p.has_api_key ? 'API key guardada' : 'sin API key'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {!p.is_active && (
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={activatingId === p.provider_id}
                            onClick={() => handleActivate(p.provider_id)}
                          >
                            {activatingId === p.provider_id ? 'Activando…' : 'Activar'}
                          </button>
                        )}
                        <button type="button" className="btn small" onClick={() => openEditForm(p)}>
                          Editar
                        </button>
                        <button type="button" className="btn small danger" onClick={() => setDeleteTarget(p)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={openCreateForm}>
              ＋ Agregar proveedor
            </button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Buzones</h3>
          <span>{mailboxes?.length ?? 0} cuenta(s) registrada(s)</span>
        </div>
        <div className="panel-body">
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
            Cada cuenta conectada aquí queda disponible para correr trabajos contra ese buzón — el buzón de mesa y
            los buzones de los agentes pueden convivir al mismo tiempo, a diferencia de los proveedores de IA de
            arriba (donde solo uno puede estar activo). Conectar una cuenta abre una pestaña nueva con el login real
            de Microsoft; al volver acá, actualiza la lista.
          </p>

          {mailboxError && <p className="form-error">{mailboxError}</p>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Proveedor</th>
                  <th>Token</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {mailboxes !== null && mailboxes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-view">
                      No hay ninguna cuenta de buzón conectada todavía.
                    </td>
                  </tr>
                )}
                {mailboxes?.map((m) => (
                  <tr key={m.mailbox_account_id}>
                    <td>
                      <span className={`badge ${m.enabled ? 'success' : ''}`}>
                        {m.enabled ? 'Habilitada' : 'Deshabilitada'}
                      </span>
                    </td>
                    <td>{m.label}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{m.email_address || '—'}</td>
                    <td>{MAILBOX_PROVIDER_LABELS[m.provider]}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {m.token_expires_at ? new Date(m.token_expires_at).toLocaleString() : 'sin token'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={testingMailboxId === m.mailbox_account_id}
                          onClick={() => handleTestMailbox(m)}
                        >
                          {testingMailboxId === m.mailbox_account_id ? 'Probando…' : 'Probar conexión'}
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          disabled={togglingMailboxId === m.mailbox_account_id}
                          onClick={() => handleToggleMailboxEnabled(m)}
                        >
                          {togglingMailboxId === m.mailbox_account_id ? 'Guardando…' : m.enabled ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                        <button type="button" className="btn small danger" onClick={() => setDeleteMailboxTarget(m)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" onClick={openConnectModal}>
              ＋ Conectar cuenta nueva
            </button>
            <button type="button" className="btn" onClick={loadMailboxes}>
              Actualizar lista
            </button>
          </div>
        </div>
      </div>

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
                      className="btn small"
                      onClick={handleFetchModels}
                      disabled={fetchingModels || (form.provider_type === 'ollama' ? !form.base_url.trim() : false)}
                    >
                      {fetchingModels ? 'Buscando…' : 'Recuperar modelos'}
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
              <button type="button" className="btn" onClick={closeForm}>
                Cancelar
              </button>
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Agregar proveedor'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div
        className={`modal-backdrop${connectModalOpen ? ' open' : ''}`}
      >
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
            <button type="button" className="btn" onClick={() => setConnectModalOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn primary" disabled={connecting} onClick={handleConnectMailbox}>
              {connecting ? 'Abriendo…' : 'Conectar con Microsoft'}
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
        confirming={deletingMailbox}
        onCancel={() => setDeleteMailboxTarget(null)}
        onConfirm={handleDeleteMailbox}
      />
    </section>
  )
}
