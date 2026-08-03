import type { MailboxIndexFolderStatus, MailboxIndexRunRead } from '../types/mailboxIndex'
import { MAILBOX_INDEX_FOLDER_STATUS_LABELS } from '../types/mailboxIndex'
import { formatNumber } from '../utils/format'

const MAILBOX_INDEX_FOLDER_STATUS_BADGE: Record<MailboxIndexFolderStatus, string> = {
  pendiente: 'queued',
  indexando: 'running',
  listo: 'success',
  parcial: 'failed',
  error: 'failed',
}

function mailboxIndexPercent(done: number, total: number): number | null {
  if (total <= 0) return null
  return Math.min(100, Math.round((done / total) * 100))
}

interface MailboxIndexProgressProps {
  run: MailboxIndexRunRead
}

export function MailboxIndexProgress({ run }: MailboxIndexProgressProps) {
  const folderPct = mailboxIndexPercent(run.processed_folders, run.total_folders)
  const messagePct = mailboxIndexPercent(run.total_messages_indexed, run.total_messages_expected)

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: run.folders.length > 0 ? 12 : 0 }}>
        {formatNumber(run.processed_folders)}/{formatNumber(run.total_folders)} carpeta(s)
        {folderPct !== null ? ` (${folderPct}%)` : ''}
        {' · '}
        {formatNumber(run.total_messages_indexed)}
        {run.total_messages_expected > 0 ? `/${formatNumber(run.total_messages_expected)}` : ''}
        {' correo(s) indexado(s)'}
        {messagePct !== null ? ` (${messagePct}%)` : ''}
        {run.error_message ? ` · ${run.error_message}` : ''}
      </p>

      {run.folders.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Carpeta</th>
                <th scope="col" style={{ width: 110 }} aria-label="Estado"></th>
                <th scope="col" style={{ width: 140 }}>Correos</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {run.folders.map((f) => (
                <tr key={f.folder_run_id}>
                  <td>{f.folder_path || f.folder_id || '—'}</td>
                  <td>
                    <span className={`badge ${MAILBOX_INDEX_FOLDER_STATUS_BADGE[f.status]}`}>
                      {MAILBOX_INDEX_FOLDER_STATUS_LABELS[f.status]}
                    </span>
                  </td>
                  <td>
                    {formatNumber(f.messages_indexed)}
                    {f.folder_total_item_count !== null ? ` / ${formatNumber(f.folder_total_item_count)}` : ''}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{f.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
