import { useEffect, useMemo, useState } from 'react'
import { listUserDirectory } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useBodyScrollLock } from '../utils/modalScrollLock'
import type { UserDirectoryEntry } from '../types/users'

export interface ShareEntry {
  user_id: number
  email_address: string
  display_name: string | null
  permission: string
}

interface ShareModalProps {
  open: boolean
  title: string
  description?: string
  allowEditPermission: boolean
  existingShares: ShareEntry[]
  sharing: boolean
  revokingUserId?: number | null
  onShare: (userId: number, permission: 'read' | 'edit') => void
  onRevoke: (userId: number) => void
  onClose: () => void
}

const DATALIST_ID = 'share-modal-user-options'

export function ShareModal({
  open,
  title,
  description,
  allowEditPermission,
  existingShares,
  sharing,
  revokingUserId = null,
  onShare,
  onRevoke,
  onClose,
}: ShareModalProps) {
  useBodyScrollLock(open)
  const { user: currentUser } = useAuth()
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [permission, setPermission] = useState<'read' | 'edit'>('read')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setFormError(null)
    setPermission('read')
    listUserDirectory()
      .then(setDirectory)
      .catch(() => setDirectory([]))
  }, [open])

  const sharedIds = useMemo(() => new Set(existingShares.map((s) => s.user_id)), [existingShares])

  const selectableUsers = useMemo(
    () => directory.filter((u) => u.user_id !== currentUser?.user_id && !sharedIds.has(u.user_id)),
    [directory, currentUser, sharedIds],
  )

  function handleShareClick() {
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
    onShare(match.user_id, allowEditPermission ? permission : 'read')
    setQuery('')
  }

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal medium">
        <div className="modal-body">
          <h3>{title}</h3>
          {description && <p>{description}</p>}

          <div className="form-grid" style={{ marginTop: 16 }}>
            <div className="field full">
              <label htmlFor="share-user-input">Usuario</label>
              <input
                id="share-user-input"
                type="text"
                list={DATALIST_ID}
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
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as 'read' | 'edit')}
                >
                  <option value="read">Solo lectura</option>
                  <option value="edit">Lectura y edición</option>
                </select>
              </div>
            )}
          </div>

          {formError && <p className="form-error" style={{ marginTop: 10 }}>{formError}</p>}

          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary btn-labeled" disabled={sharing} onClick={handleShareClick}>
              {sharing ? 'Compartiendo…' : '＋ Compartir'}
            </button>
          </div>

          <h3 style={{ marginTop: 24, fontSize: 13 }}>Ya tienen acceso</h3>
          {existingShares.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>Todavía no se compartió con nadie.</p>
          ) : (
            <div className="panel" style={{ marginTop: 8 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th style={{ width: 170 }}>Permiso</th>
                    <th style={{ width: 76 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {existingShares.map((s) => (
                    <tr key={s.user_id}>
                      <td>{s.display_name || s.email_address}</td>
                      <td>{s.permission === 'edit' ? 'Lectura y edición' : 'Solo lectura'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn small danger icon-btn"
                          disabled={revokingUserId === s.user_id}
                          data-tooltip="Quitar"
                          aria-label="Quitar"
                          onClick={() => onRevoke(s.user_id)}
                        >
                          {revokingUserId === s.user_id ? '…' : '✕'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-labeled" onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
