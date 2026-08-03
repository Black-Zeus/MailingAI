import { useEffect, useId, useState } from 'react'
import { listUserDirectory } from '../api/client'
import { useModalBehavior } from '../utils/modalScrollLock'
import type { UserDirectoryEntry } from '../types/users'
import { LabeledButton } from './LabeledButton'

interface ReassignOwnerModalProps {
  open: boolean
  caseTitle: string
  previousOwnerLabel: string | null
  reassigning: boolean
  onConfirm: (userId: number) => void
  onClose: () => void
}

const DATALIST_ID = 'reassign-owner-user-options'

export function ReassignOwnerModal({
  open,
  caseTitle,
  previousOwnerLabel,
  reassigning,
  onConfirm,
  onClose,
}: ReassignOwnerModalProps) {
  const titleId = useId()
  const modalRef = useModalBehavior(open, onClose)
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError(null)
    listUserDirectory()
      .then(setDirectory)
      .catch(() => setDirectory([]))
  }, [open])

  function handleConfirm() {
    const normalized = query.trim().toLowerCase()
    const match = directory.find((u) => u.email_address.toLowerCase() === normalized)
    if (!match) {
      setError('Escribe o selecciona un usuario válido de la lista.')
      return
    }
    setError(null)
    onConfirm(match.user_id)
  }

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
          <h3 id={titleId}>Reasignar dueño de "{caseTitle}"</h3>
          {previousOwnerLabel && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Este expediente quedó a nombre de un admin tras eliminarse una cuenta — el dueño original era{' '}
              <strong>{previousOwnerLabel}</strong>.
            </p>
          )}
          <div className="field full mt-5">
            <label htmlFor="reassign-owner-input">Nuevo dueño</label>
            <input
              id="reassign-owner-input"
              type="text"
              list={DATALIST_ID}
              placeholder="Escribe un nombre o email…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setError(null)
              }}
            />
            <datalist id={DATALIST_ID}>
              {directory.map((u) => (
                <option key={u.user_id} value={u.email_address}>
                  {u.display_name ? `${u.display_name} — ${u.email_address}` : u.email_address}
                </option>
              ))}
            </datalist>
          </div>
          {error && <p className="form-error mt-4">{error}</p>}
        </div>
        <div className="modal-actions">
          <LabeledButton onClick={onClose}>✕ Cancelar</LabeledButton>
          <LabeledButton variant="primary" loading={reassigning} loadingText="Reasignando…" onClick={handleConfirm}>
            ✓ Reasignar
          </LabeledButton>
        </div>
      </div>
    </div>
  )
}
