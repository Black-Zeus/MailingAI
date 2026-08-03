import { useEffect, useId, useMemo, useState } from 'react'
import { listUserDirectory } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useModalBehavior } from '../utils/modalScrollLock'
import type { UserDirectoryEntry } from '../types/users'
import { ActionButton } from './ActionButton'
import { LabeledButton } from './LabeledButton'
import { Undo2, X } from 'lucide-react'

export interface ShareEntry {
  user_id: number
  email_address: string
  display_name: string | null
  permission: string
}

export interface PendingShareChanges {
  adds: { userId: number; permission: 'read' | 'edit' }[]
  removeUserIds: number[]
}

interface ShareModalProps {
  open: boolean
  title: string
  description?: string
  allowEditPermission: boolean
  existingShares: ShareEntry[]
  saving: boolean
  onConfirm: (changes: PendingShareChanges) => Promise<void> | void
  onClose: () => void
}

const DATALIST_ID = 'share-modal-user-options'

export function ShareModal({
  open,
  title,
  description,
  allowEditPermission,
  existingShares,
  saving,
  onConfirm,
  onClose,
}: ShareModalProps) {
  const titleId = useId()
  const modalRef = useModalBehavior(open, handleCancel)
  const { user: currentUser } = useAuth()
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [permission, setPermission] = useState<'read' | 'edit'>('read')
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingAdds, setPendingAdds] = useState<ShareEntry[]>([])
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    setQuery('')
    setFormError(null)
    setPermission('read')
    setPendingAdds([])
    setPendingRemoveIds(new Set())
    listUserDirectory()
      .then(setDirectory)
      .catch(() => setDirectory([]))
  }, [open])

  const sharedIds = useMemo(() => new Set(existingShares.map((s) => s.user_id)), [existingShares])
  const pendingAddIds = useMemo(() => new Set(pendingAdds.map((s) => s.user_id)), [pendingAdds])

  const selectableUsers = useMemo(
    () => directory.filter((u) => u.user_id !== currentUser?.user_id && !sharedIds.has(u.user_id) && !pendingAddIds.has(u.user_id)),
    [directory, currentUser, sharedIds, pendingAddIds],
  )

  const hasPendingChanges = pendingAdds.length > 0 || pendingRemoveIds.size > 0

  function handleStageAdd() {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      setFormError('Escribe o selecciona un usuario de la lista.')
      return
    }
    const match = selectableUsers.find((u) => u.email_address.toLowerCase() === normalized)
    if (!match) {
      setFormError('Ese usuario no existe o no está disponible para compartir. Selecciónalo de la lista.')
      return
    }
    setFormError(null)
    setPendingAdds((prev) => [
      ...prev,
      {
        user_id: match.user_id,
        email_address: match.email_address,
        display_name: match.display_name,
        permission: allowEditPermission ? permission : 'read',
      },
    ])
    setQuery('')
  }

  function handleUndoAdd(userId: number) {
    setPendingAdds((prev) => prev.filter((s) => s.user_id !== userId))
  }

  function handleStageRemove(userId: number) {
    setPendingRemoveIds((prev) => new Set(prev).add(userId))
  }

  function handleUndoRemove(userId: number) {
    setPendingRemoveIds((prev) => {
      const next = new Set(prev)
      next.delete(userId)
      return next
    })
  }

  function handleCancel() {
    setPendingAdds([])
    setPendingRemoveIds(new Set())
    setQuery('')
    onClose()
  }

  async function handleConfirmClick() {
    if (!hasPendingChanges) return
    await onConfirm({
      adds: pendingAdds.map((s) => ({ userId: s.user_id, permission: s.permission === 'edit' ? 'edit' : 'read' })),
      removeUserIds: [...pendingRemoveIds],
    })
    setPendingAdds([])
    setPendingRemoveIds(new Set())
  }

  const showTable = existingShares.length > 0 || pendingAdds.length > 0

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div
        className="modal medium"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-body">
          <h3 id={titleId}>{title}</h3>
          {description && <p>{description}</p>}

          <div className="form-grid mt-7">
            <div className="field full">
              <label htmlFor="share-user-input">Usuario</label>
              <input
                id="share-user-input"
                type="text"
                list={DATALIST_ID}
                disabled={saving}
                placeholder="Escribe un nombre o email…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setFormError(null)
                }}
              />
              <datalist id={DATALIST_ID}>
                {selectableUsers.map((u) => (
                  <option key={u.user_id} value={u.email_address}>
                    {u.display_name ? `${u.display_name} — ${u.email_address}` : u.email_address}
                  </option>
                ))}
              </datalist>
            </div>
            {allowEditPermission && (
              <div className="field">
                <label htmlFor="share-permission">Permiso</label>
                <select
                  id="share-permission"
                  disabled={saving}
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as 'read' | 'edit')}
                >
                  <option value="read">Solo lectura</option>
                  <option value="edit">Lectura y edición</option>
                </select>
              </div>
            )}
          </div>

          {formError && <p className="form-error mt-4">{formError}</p>}

          <div className="actions mt-5">
            <LabeledButton variant="primary" disabled={saving} onClick={handleStageAdd}>
              ＋ Agregar a la lista
            </LabeledButton>
          </div>

          <h3 style={{ marginTop: 24, fontSize: 13 }}>Ya tienen acceso</h3>
          {!showTable ? (
            <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>Todavía no se compartió con nadie.</p>
          ) : (
            <div className="panel" style={{ marginTop: 8 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Usuario</th>
                    <th scope="col" style={{ width: 170 }}>Permiso</th>
                    <th scope="col" style={{ width: 76 }} aria-label="Acciones"></th>
                  </tr>
                </thead>
                <tbody>
                  {existingShares.map((s) => {
                    const isPendingRemoval = pendingRemoveIds.has(s.user_id)
                    return (
                      <tr key={s.user_id} style={isPendingRemoval ? { opacity: 0.5 } : undefined}>
                        <td>{s.display_name || s.email_address}</td>
                        <td>
                          {s.permission === 'edit' ? 'Lectura y edición' : 'Solo lectura'}
                          {isPendingRemoval && <span className="badge failed ml-2">se quitará</span>}
                        </td>
                        <td>
                          {isPendingRemoval ? (
                            <ActionButton icon={Undo2} label="Deshacer" disabled={saving} onClick={() => handleUndoRemove(s.user_id)} />
                          ) : (
                            <ActionButton
                              icon={X}
                              label="Quitar"
                              variant="danger"
                              disabled={saving}
                              onClick={() => handleStageRemove(s.user_id)}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {pendingAdds.map((s) => (
                    <tr key={`pending-${s.user_id}`} style={{ opacity: 0.85 }}>
                      <td>{s.display_name || s.email_address}</td>
                      <td>
                        {s.permission === 'edit' ? 'Lectura y edición' : 'Solo lectura'}
                        <span className="badge success ml-2">nuevo</span>
                      </td>
                      <td>
                        <ActionButton icon={X} label="Quitar de la lista" disabled={saving} onClick={() => handleUndoAdd(s.user_id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          )}
          <p style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 10 }}>
            Los cambios de arriba quedan pendientes hasta confirmar.
          </p>
        </div>
        <div className="modal-actions">
          <LabeledButton disabled={saving} onClick={handleCancel}>
            ✕ Cancelar
          </LabeledButton>
          <LabeledButton variant="primary" disabled={saving || !hasPendingChanges} loading={saving} loadingText="Guardando…" onClick={handleConfirmClick}>
            ✓ Confirmar
          </LabeledButton>
        </div>
      </div>
    </div>
  )
}
