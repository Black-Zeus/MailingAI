import { useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalBehavior } from '../utils/modalScrollLock'
import { LabeledButton } from './LabeledButton'

interface ConfirmModalProps {
  open: boolean
  title: string
  description: string
  children?: ReactNode
  confirmLabel?: string
  confirmingLabel?: string
  confirmIcon?: string
  confirmDanger?: boolean
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
  confirmingLabel = 'Procesando…',
  confirmIcon = '🗑',
  confirmDanger = true,
  onCancel,
  onConfirm,
  confirming = false,
}: ConfirmModalProps) {
  const titleId = useId()
  const modalRef = useModalBehavior(open, onCancel)
  // Portal a document.body: algunos llamadores (ej. NotificationBell) viven
  // dentro de un ancestro con backdrop-filter/filter, lo que crea un
  // containing block nuevo para descendientes position:fixed y descentra el
  // modal. El portal lo saca de esa jerarquía siempre, sin costo para los
  // llamadores que ya estaban fuera de ese caso.
  return createPortal(
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-body">
          <h3 id={titleId}>{title}</h3>
          <p>{description}</p>
          {children}
        </div>
        <div className="modal-actions">
          <LabeledButton onClick={onCancel}>✕ Cancelar</LabeledButton>
          <LabeledButton
            variant={confirmDanger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={confirming}
            loadingText={confirmingLabel}
          >
            {`${confirmIcon} ${confirmLabel}`}
          </LabeledButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}
