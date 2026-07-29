import { useEffect, useState } from 'react'
import { ApiError, listAttachments } from '../api/client'
import type { AttachmentListItem } from '../types/messages'
import { AttachmentItem } from '../components/AttachmentItem'
import { toEndOfDayISO, toStartOfDayISO } from '../utils/dates'

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CL')
}

interface FilterState {
  file_name_contains: string
  extension: string
  date_from: string
  date_to: string
  only_hashed: 'all' | 'yes' | 'no'
  only_linked_to_case: 'all' | 'yes' | 'no'
}

const EMPTY_FILTERS: FilterState = {
  file_name_contains: '',
  extension: '',
  date_from: '',
  date_to: '',
  only_hashed: 'all',
  only_linked_to_case: 'all',
}

export function AttachmentsView() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [attachments, setAttachments] = useState<AttachmentListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function runSearch() {
    setLoading(true)
    setError(null)
    try {
      const data = await listAttachments({
        file_name_contains: filters.file_name_contains || undefined,
        extension: filters.extension || undefined,
        date_from: filters.date_from ? toStartOfDayISO(filters.date_from) : undefined,
        date_to: filters.date_to ? toEndOfDayISO(filters.date_to) : undefined,
        only_hashed: filters.only_hashed === 'all' ? undefined : filters.only_hashed === 'yes',
        only_linked_to_case: filters.only_linked_to_case === 'all' ? undefined : filters.only_linked_to_case === 'yes',
        limit: 200,
      })
      setAttachments(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los adjuntos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = attachments?.length ?? 0
  const hashed = attachments?.filter((a) => a.content_sha256).length ?? 0
  const linked = attachments?.filter((a) => a.linked_to_case).length ?? 0

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Adjuntos</h2>
          <p>
            Todos los archivos reales encontrados en el buzón indexado, como evidencia propia — sin tener que abrir
            cada correo uno por uno.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span>Adjuntos listados</span>
          <strong>{total}</strong>
        </div>
        <div className="kpi">
          <span>Con hash verificado</span>
          <strong style={{ color: 'var(--accent)' }}>{hashed}</strong>
        </div>
        <div className="kpi">
          <span>Vinculados a expediente</span>
          <strong style={{ color: 'var(--accent-2)' }}>{linked}</strong>
        </div>
      </div>
      {attachments && attachments.length >= 200 && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: -14, marginBottom: 16 }}>
          Se muestran los primeros 200 resultados — afiná los filtros para ver totales exactos si hay más.
        </p>
      )}

      <div className="toolbar">
        <input
          type="text"
          placeholder="Nombre de archivo contiene..."
          value={filters.file_name_contains}
          onChange={(e) => setFilters((f) => ({ ...f, file_name_contains: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          style={{ minWidth: 220 }}
        />
        <input
          type="text"
          placeholder="Extensión (ej. pdf)"
          value={filters.extension}
          onChange={(e) => setFilters((f) => ({ ...f, extension: e.target.value }))}
          style={{ maxWidth: 140 }}
        />
        <input
          type="date"
          value={filters.date_from}
          onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
        />
        <input
          type="date"
          value={filters.date_to}
          onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
        />
        <select
          value={filters.only_hashed}
          onChange={(e) => setFilters((f) => ({ ...f, only_hashed: e.target.value as FilterState['only_hashed'] }))}
        >
          <option value="all">Con o sin hash</option>
          <option value="yes">Solo con hash verificado</option>
          <option value="no">Solo sin descargar todavía</option>
        </select>
        <select
          value={filters.only_linked_to_case}
          onChange={(e) =>
            setFilters((f) => ({ ...f, only_linked_to_case: e.target.value as FilterState['only_linked_to_case'] }))
          }
        >
          <option value="all">Vinculados o no a expediente</option>
          <option value="yes">Solo vinculados a un expediente</option>
          <option value="no">Solo sin expediente</option>
        </select>
        <button type="button" className="btn primary" onClick={runSearch} disabled={loading}>
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Buzón</th>
              <th>Archivo</th>
              <th>Correo</th>
              <th>De</th>
              <th>Fecha</th>
              <th>Carpeta</th>
              <th>Expediente</th>
            </tr>
          </thead>
          <tbody>
            {attachments !== null && attachments.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="empty-view">
                  No hay adjuntos para estos filtros.
                </td>
              </tr>
            )}
            {attachments?.map((a) => (
              <tr key={`${a.message_id}-${a.attachment_id}`}>
                <td>{a.mailbox_label || <span style={{ color: 'var(--muted)' }}>sin etiquetar</span>}</td>
                <td>
                  <div className="attachment-tags">
                    <AttachmentItem
                      messageId={a.message_id}
                      attachmentId={a.attachment_id}
                      fileName={a.file_name}
                      extension={a.extension}
                      sizeBytes={a.size_bytes}
                      matchesNamingConvention={a.matches_naming_convention}
                      matchesSearchPattern={a.matches_search_pattern}
                      contentSha256={a.content_sha256}
                    />
                  </div>
                </td>
                <td>{a.message_subject || '(sin asunto)'}</td>
                <td>{a.message_from_address || '—'}</td>
                <td>{formatDateTime(a.message_sent_datetime)}</td>
                <td>{a.folder_path || '—'}</td>
                <td>{a.linked_to_case ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
