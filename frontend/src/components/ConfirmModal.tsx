import type { ReactNode } from 'react'
import { useBodyScrollLock } from '../utils/modalScrollLock'

interface ConfirmModalProps {
  open: boolean
  title: string
  description: string
  children?: ReactNode
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
  confirming?: boolean
}

export function ConfirmModal({
  open,
  title,
  description,
  children,
  confirmLabel = 'Confirmar',
  onCancel,
  onConfirm,
  confirming = false,
}: ConfirmModalProps) {
  useBodyScrollLock(open)
  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal">
        <div className="modal-body">
          <h3>{title}</h3>
          <p>{description}</p>
          {children}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn danger" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Eliminando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
