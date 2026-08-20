import { MessageBodyView } from './MessageBodyModal'
import { formatDateTime } from '../utils/timeline'
import type { CaseSentEmailRead } from '../types/cases'

export function SentEmailPreviewModal({
  email,
  onClose,
}: {
  email: CaseSentEmailRead | null
  onClose: () => void
}) {
  return (
    <div className={`modal-backdrop${email !== null ? ' open' : ''}`}>
      <div className="modal wide">
        <div className="modal-body">
          <h3>Correo enviado</h3>
          {email && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '4px 10px', marginBottom: 10, fontSize: 13 }}>
                <strong>Fecha</strong>
                <span>{formatDateTime(email.sent_at)}</span>
                <strong>Enviado por</strong>
                <span>{email.sent_by_label ?? '—'}</span>
                <strong>Para</strong>
                <span>{email.to_addresses.join(', ')}</span>
                {email.cc_addresses.length > 0 && (
                  <>
                    <strong>CC</strong>
                    <span>{email.cc_addresses.join(', ')}</span>
                  </>
                )}
                <strong>Asunto</strong>
                <span>{email.subject}</span>
              </div>
              {(email.attached_case_pdf || email.attachment_names.length > 0) && (
                <div className="attachment-tags" style={{ marginBottom: 12 }}>
                  {email.attached_case_pdf && (
                    <span className="attachment-tag" style={{ fontSize: 13, padding: '10px 12px' }}>
                      <b>PDF</b>📄 Expediente adjunto
                    </span>
                  )}
                  {email.attachment_names.map((name, idx) => (
                    <span key={`${name}-${idx}`} className="attachment-tag" style={{ fontSize: 13, padding: '10px 12px' }}>
                      <b>{(name.split('.').pop() || 'archivo').toUpperCase()}</b>📎 {name}
                    </span>
                  ))}
                </div>
              )}
              <MessageBodyView content={email.body_html} contentType="html" />
            </>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn small btn-labeled" onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
