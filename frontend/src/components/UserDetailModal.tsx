import { useEffect, useMemo, useState } from 'react'
import { clearMailboxOwner, listMailboxes, listUserMailboxes, revokeMailboxShare, shareMailbox } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useBodyScrollLock } from '../utils/modalScrollLock'
import type { UserRead, UserMailboxAccessEntry } from '../types/users'
import type { MailboxAccountRead } from '../types/mailboxes'

interface UserDetailModalProps {
  open: boolean
  user: UserRead | null
  onClose: () => void
}

const DATALIST_ID = 'user-detail-mailbox-options'

export function UserDetailModal({ open, user, onClose }: UserDetailModalProps) {
  useBodyScrollLock(open)
  const { showToast } = useToast()
  const [access, setAccess] = useState<UserMailboxAccessEntry[]>([])
  const [allMailboxes, setAllMailboxes] = useState<MailboxAccountRead[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingAdds, setPendingAdds] = useState<MailboxAccountRead[]>([])
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  async function load(userId: number) {
    setLoading(true)
    try {
      const [accessData, mailboxesData] = await Promise.all([listUserMailboxes(userId), listMailboxes()])
      setAccess(accessData)
      setAllMailboxes(mailboxesData)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo cargar la ficha del usuario.', true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && user) {
      setQuery('')
      setPendingAdds([])
      setPendingRemoveIds(new Set())
      load(user.user_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.user_id])

  const accessIds = useMemo(() => new Set(access.map((a) => a.mailbox_account_id)), [access])
  const pendingAddIds = useMemo(() => new Set(pendingAdds.map((m) => m.mailbox_account_id)), [pendingAdds])
  const selectableMailboxes = useMemo(
    () => allMailboxes.filter((m) => !accessIds.has(m.mailbox_account_id) && !pendingAddIds.has(m.mailbox_account_id)),
    [allMailboxes, accessIds, pendingAddIds],
  )
  const hasPendingChanges = pendingAdds.length > 0 || pendingRemoveIds.size > 0

  function labelFor(m: MailboxAccountRead): string {
    return m.email_address ? `${m.label} — ${m.email_address}` : m.label
  }

  function handleStageAdd() {
    const normalized = query.trim().toLowerCase()
    const match = selectableMailboxes.find((m) => labelFor(m).toLowerCase() === normalized)
    if (!match) {
      showToast('Selecciona un buzón de la lista.', true)
      return
    }
    setPendingAdds((prev) => [...prev, match])
    setQuery('')
  }

  function handleUndoAdd(mailboxAccountId: number) {
    setPendingAdds((prev) => prev.filter((m) => m.mailbox_account_id !== mailboxAccountId))
  }

  function handleStageRemove(entry: UserMailboxAccessEntry) {
    setPendingRemoveIds((prev) => new Set(prev).add(entry.mailbox_account_id))
  }

  function handleUndoRemove(mailboxAccountId: number) {
    setPendingRemoveIds((prev) => {
      const next = new Set(prev)
      next.delete(mailboxAccountId)
      return next
    })
  }

  function handleCancel() {
    setPendingAdds([])
    setPendingRemoveIds(new Set())
    setQuery('')
    onClose()
  }

  async function handleConfirm() {
    if (!user || !hasPendingChanges) return
    setSaving(true)
    let casesAffected = 0
    let failCount = 0
    const stillPendingAdds: MailboxAccountRead[] = []
    const stillPendingRemoveIds = new Set<number>()

    for (const mailbox of pendingAdds) {
      try {
        await shareMailbox(mailbox.mailbox_account_id, user.user_id, 'read')
      } catch {
        failCount += 1
        stillPendingAdds.push(mailbox)
      }
    }

    for (const mailboxAccountId of pendingRemoveIds) {
      const entry = access.find((a) => a.mailbox_account_id === mailboxAccountId)
      try {
        const result =
          entry?.relation === 'owner'
            ? await clearMailboxOwner(mailboxAccountId)
            : await revokeMailboxShare(mailboxAccountId, user.user_id)
        casesAffected += result.cases_affected
      } catch {
        failCount += 1
        stillPendingRemoveIds.add(mailboxAccountId)
      }
    }

    await load(user.user_id)
    setPendingAdds(stillPendingAdds)
    setPendingRemoveIds(stillPendingRemoveIds)
    setSaving(false)

    if (failCount === 0) {
      showToast(
        casesAffected > 0
          ? `Cambios guardados. También se removió el acceso a ${casesAffected} expediente(s) relacionado(s).`
          : 'Cambios guardados.',
      )
      onClose()
    } else {
      showToast(`${failCount} cambio(s) no se pudieron aplicar — revisa la lista e intenta de nuevo.`, true)
    }
  }

  const showTable = access.length > 0 || pendingAdds.length > 0

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal medium">
        <div className="modal-body">
          <h3>{user ? user.display_name || user.email_address : 'Usuario'}</h3>
          {user && <p>{user.email_address} · {user.role === 'admin' ? 'Admin' : 'Usuario'} · {user.enabled ? 'Activo' : 'Desactivado'}</p>}

          <h3 style={{ marginTop: 20, fontSize: 13 }}>Compartir un buzón nuevo</h3>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field full">
              <input
                type="text"
                list={DATALIST_ID}
                placeholder="Escribe el nombre o email del buzón…"
                value={query}
                disabled={saving}
                onChange={(e) => setQuery(e.target.value)}
              />
              <datalist id={DATALIST_ID}>
                {selectableMailboxes.map((m) => (
                  <option key={m.mailbox_account_id} value={labelFor(m)} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn primary btn-labeled" disabled={saving} onClick={handleStageAdd}>
              ＋ Agregar a la lista
            </button>
          </div>

          <h3 style={{ marginTop: 24, fontSize: 13 }}>Buzones a los que tiene acceso</h3>
          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>Cargando…</p>
          ) : !showTable ? (
            <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>No tiene acceso a ningún buzón todavía.</p>
          ) : (
            <div className="panel" style={{ marginTop: 8 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Buzón</th>
                    <th>Correo</th>
                    <th style={{ width: 130 }}>Relación</th>
                    <th style={{ width: 76 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {access.map((a) => {
                    const isPendingRemoval = pendingRemoveIds.has(a.mailbox_account_id)
                    return (
                      <tr key={a.mailbox_account_id} style={isPendingRemoval ? { opacity: 0.5 } : undefined}>
                        <td>{a.label}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{a.email_address || '—'}</td>
                        <td>
                          {a.relation === 'owner' ? 'Dueño' : 'Solo lectura'}
                          {isPendingRemoval && (
                            <span className="badge failed" style={{ marginLeft: 6 }}>
                              se quitará
                            </span>
                          )}
                        </td>
                        <td>
                          {isPendingRemoval ? (
                            <button
                              type="button"
                              className="btn small icon-btn"
                              disabled={saving}
                              data-tooltip="Deshacer"
                              aria-label="Deshacer"
                              onClick={() => handleUndoRemove(a.mailbox_account_id)}
                            >
                              ↺
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn small danger icon-btn"
                              disabled={saving}
                              data-tooltip={a.relation === 'owner' ? 'Liberar buzón' : 'Quitar acceso'}
                              aria-label={a.relation === 'owner' ? 'Liberar buzón' : 'Quitar acceso'}
                              onClick={() => handleStageRemove(a)}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {pendingAdds.map((m) => (
                    <tr key={`pending-${m.mailbox_account_id}`} style={{ opacity: 0.85 }}>
                      <td>{m.label}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{m.email_address || '—'}</td>
                      <td>
                        Solo lectura
                        <span className="badge success" style={{ marginLeft: 6 }}>
                          nuevo
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn small icon-btn"
                          disabled={saving}
                          data-tooltip="Quitar de la lista"
                          aria-label="Quitar de la lista"
                          onClick={() => handleUndoAdd(m.mailbox_account_id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          )}
          <p style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 10 }}>
            Los cambios de arriba quedan pendientes hasta confirmar. Al confirmar, quitar el acceso a un buzón
            también le remueve el acceso a cualquier expediente relacionado (si era dueño, el expediente queda sin
            dueño; si se lo habían compartido, se le revoca esa compartición).
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-labeled" disabled={saving} onClick={handleCancel}>
            ✕ Cancelar
          </button>
          <button
            type="button"
            className="btn primary btn-labeled"
            disabled={saving || !hasPendingChanges}
            onClick={handleConfirm}
          >
            {saving ? 'Guardando…' : '✓ Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
