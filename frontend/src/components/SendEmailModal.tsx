import { Bot, Check, HelpCircle, RefreshCw, X } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { RecipientInput } from './RecipientInput'
import type { MailboxAccountRead } from '../types/mailboxes'

export interface SendEmailFormState {
  to: string
  cc: string
  subject: string
  body: string
  mailboxAccountId: number | null
  attachPdf: boolean
  files: File[]
}

// Markup puro (sin estado propio) -- CasesView sigue siendo dueño de
// sendEmailForm/sendEmailTarget porque el flujo de "Generar reporte" (otro
// modal) tambien escribe en ese mismo form antes de abrir este, y varios
// handlers (abrir el modal, mandar el correo) necesitan datos que ya viven
// en CasesView (details, mailboxAccounts, exportCasePdfBlob). Sacar el JSX
// igual reduce el archivo en ~150 lineas sin arriesgar ese acoplamiento.
export function SendEmailModal({
  open,
  form,
  onFormChange,
  mailboxAccounts,
  sendingEmail,
  loadingEmailPreview,
  summarizingBody,
  bodySuggestion,
  onClose,
  onPreview,
  onSend,
  onSummarizeBody,
  onAcceptBodySuggestion,
  onRejectBodySuggestion,
  onOpenMarkdownHelp,
}: {
  open: boolean
  form: SendEmailFormState
  onFormChange: (updater: (prev: SendEmailFormState) => SendEmailFormState) => void
  mailboxAccounts: MailboxAccountRead[]
  sendingEmail: boolean
  loadingEmailPreview: boolean
  summarizingBody: boolean
  bodySuggestion: string | null
  onClose: () => void
  onPreview: () => void
  onSend: () => void
  onSummarizeBody: () => void
  onAcceptBodySuggestion: () => void
  onRejectBodySuggestion: () => void
  onOpenMarkdownHelp: () => void
}) {
  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      {/* overflow:hidden + flex-column inline (solo esta instancia, no toca
          la clase .modal compartida) -- header (Para/CC/Asunto) y botonera
          quedan fijos, solo el cuerpo (Cuerpo + IA + adjuntos) scrollea. */}
      <div className="modal xwide" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          className="modal-body"
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}
        >
          <h3 style={{ flexShrink: 0 }}>Enviar correo</h3>
          <p style={{ flexShrink: 0 }}>
            Se prellena con los involucrados del último correo del expediente. El PDF del expediente se adjunta
            automáticamente si se deja marcada la casilla.
          </p>
          <div className="form-grid mt-6" style={{ flexShrink: 0 }}>
            <div className="field">
              <label htmlFor="sendEmailTo">Para</label>
              <RecipientInput
                id="sendEmailTo"
                value={form.to}
                onChange={(to) => onFormChange((prev) => ({ ...prev, to }))}
                placeholder="Escribí un nombre o correo…"
              />
            </div>
            <div className="field">
              <label htmlFor="sendEmailCc">Con copia (CC)</label>
              <RecipientInput
                id="sendEmailCc"
                value={form.cc}
                onChange={(cc) => onFormChange((prev) => ({ ...prev, cc }))}
                placeholder="Escribí un nombre o correo…"
              />
            </div>
            <div className="field full">
              <label htmlFor="sendEmailSubject">Asunto</label>
              <input
                id="sendEmailSubject"
                type="text"
                value={form.subject}
                onChange={(e) => onFormChange((prev) => ({ ...prev, subject: e.target.value }))}
              />
            </div>
          </div>
          <div
            className="form-grid mt-6"
            style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingTop: 4, paddingRight: 4 }}
          >
            <div className="field full">
              <label htmlFor="sendEmailBody" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Cuerpo (Markdown — se precarga con la última nota del auditor, se convierte a HTML al enviar)</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
                  <ActionButton
                    icon={HelpCircle}
                    label="Ayuda de formato Markdown"
                    size="sm"
                    className="tooltip-below"
                    onClick={onOpenMarkdownHelp}
                  />
                  <ActionButton
                    icon={Bot}
                    label={summarizingBody ? 'Resumiendo…' : 'Resumir con IA'}
                    size="sm"
                    className="tooltip-below"
                    loading={summarizingBody}
                    disabled={!form.body.trim()}
                    onClick={onSummarizeBody}
                  />
                </span>
              </label>
              <textarea
                id="sendEmailBody"
                rows={8}
                value={form.body}
                onChange={(e) => onFormChange((prev) => ({ ...prev, body: e.target.value }))}
                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              />
              {bodySuggestion !== null && (
                <div className="panel" style={{ marginTop: 8, padding: 10 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--muted)' }}>
                    Sugerencia de IA — revisa antes de aceptar:
                  </p>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 8 }}>{bodySuggestion}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <ActionButton icon={Check} label="Aceptar" size="sm" variant="primary" onClick={onAcceptBodySuggestion} />
                    <ActionButton icon={X} label="Rechazar" size="sm" onClick={onRejectBodySuggestion} />
                    <ActionButton
                      icon={RefreshCw}
                      label={summarizingBody ? 'Reiterando…' : 'Reiterar'}
                      size="sm"
                      loading={summarizingBody}
                      onClick={onSummarizeBody}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="sendEmailMailbox">Enviar desde</label>
              <select
                id="sendEmailMailbox"
                value={form.mailboxAccountId ?? ''}
                onChange={(e) =>
                  onFormChange((prev) => ({ ...prev, mailboxAccountId: e.target.value ? Number(e.target.value) : null }))
                }
              >
                <option value="">Selecciona un buzón</option>
                {mailboxAccounts
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                      {m.label} ({m.email_address})
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sendEmailAttachments">Adjuntos adicionales</label>
              <input
                id="sendEmailAttachments"
                type="file"
                multiple
                onChange={(e) => onFormChange((prev) => ({ ...prev, files: e.target.files ? Array.from(e.target.files) : [] }))}
              />
            </div>
            <div className="field full">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.attachPdf}
                  onChange={(e) => onFormChange((prev) => ({ ...prev, attachPdf: e.target.checked }))}
                />
                Adjuntar PDF del expediente
              </label>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn small btn-labeled" disabled={sendingEmail} onClick={onClose}>
            ✕ Cancelar
          </button>
          <button
            type="button"
            className="btn small btn-labeled"
            disabled={!form.body.trim() || loadingEmailPreview}
            onClick={onPreview}
          >
            {loadingEmailPreview ? 'Generando…' : '👁 Vista previa'}
          </button>
          <button type="button" className="btn small primary btn-labeled" disabled={sendingEmail} onClick={onSend}>
            {sendingEmail ? 'Enviando…' : '✉ Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
