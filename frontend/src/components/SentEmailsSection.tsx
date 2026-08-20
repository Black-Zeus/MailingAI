import { useState } from 'react'
import { Eye } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { formatDateTime } from '../utils/timeline'
import type { CaseSentEmailRead } from '../types/cases'

export function SentEmailsSection({
  sentEmails,
  onViewEmail,
}: {
  sentEmails: CaseSentEmailRead[] | undefined
  onViewEmail: (email: CaseSentEmailRead) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="add-message-search">
      <button type="button" className="btn small btn-labeled" onClick={() => setOpen((prev) => !prev)}>
        {open ? '📤 Ocultar correos enviados ▾' : `📤 Correos enviados (${sentEmails?.length ?? 0}) ▸`}
      </button>
      {open && (
        <>
          {sentEmails && sentEmails.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>
              Todavía no se envió ningún correo desde este expediente.
            </p>
          )}
          {sentEmails && sentEmails.length > 0 && (
            <div className="panel table-wrap mt-5">
              <table>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 160 }}>Fecha</th>
                    <th scope="col">Asunto</th>
                    <th scope="col">Para</th>
                    <th scope="col" style={{ width: 100 }}>Enviado por</th>
                    <th scope="col" style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...sentEmails]
                    .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
                    .map((se) => (
                      <tr key={se.sent_email_id}>
                        <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {formatDateTime(se.sent_at)}
                        </td>
                        <td>{se.subject}</td>
                        <td>{se.to_addresses.join(', ')}</td>
                        <td>{se.sent_by_label ?? '—'}</td>
                        <td>
                          <ActionButton icon={Eye} label="Ver correo" size="sm" onClick={() => onViewEmail(se)} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
