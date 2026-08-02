import { useEffect, useState } from 'react'
import { ApiError, getCase } from '../api/client'
import type { CaseDetail } from '../types/cases'
import { CASE_OUTCOME_LABELS } from '../types/cases'
import { useToast } from '../context/ToastContext'
import { useBodyScrollLock } from '../utils/modalScrollLock'
import { formatDateTime } from '../utils/timeline'

interface CaseDetailModalProps {
  open: boolean
  caseId: number | null
  onClose: () => void
}

export function CaseDetailModal({ open, caseId, onClose }: CaseDetailModalProps) {
  useBodyScrollLock(open)
  const { showToast } = useToast()
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || caseId === null) return
    let cancelled = false
    setLoading(true)
    setDetail(null)
    getCase(caseId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((err) => {
        if (!cancelled) showToast(err instanceof ApiError ? err.message : 'No se pudo cargar el expediente.', true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseId])

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal wide">
        <div className="modal-body">
          {loading && <p style={{ color: 'var(--muted)' }}>Cargando…</p>}
          {!loading && detail && (
            <>
              <h3>{detail.title}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '4px 10px', margin: '10px 0', fontSize: 13 }}>
                <strong>Estado</strong>
                <span>{detail.status === 'open' ? 'Abierto' : 'Cerrado'}</span>
                <strong>Conclusión</strong>
                <span>{detail.outcome ? CASE_OUTCOME_LABELS[detail.outcome] : '—'}</span>
                <strong>Acción pendiente</strong>
                <span>{detail.pending_action || '—'}</span>
                <strong>Próxima revisión</strong>
                <span>{detail.next_review_at || '—'}</span>
                <strong>Mensajes</strong>
                <span>{detail.message_count}</span>
              </div>

              {(detail.ai_summary_override || detail.latest_ai_run?.result?.summary) && (
                <>
                  <h4 style={{ marginTop: 16 }}>Resumen de IA</h4>
                  <p style={{ fontSize: 13 }}>{detail.ai_summary_override || detail.latest_ai_run?.result?.summary}</p>
                </>
              )}

              {detail.notes.length > 0 && (
                <>
                  <h4 style={{ marginTop: 16 }}>Notas del auditor</h4>
                  {[...detail.notes]
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .map((note) => (
                      <div key={note.note_id} style={{ marginBottom: 10, fontSize: 13 }}>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>{formatDateTime(note.created_at)}</div>
                        <div className="md-content" dangerouslySetInnerHTML={{ __html: note.body }} />
                      </div>
                    ))}
                </>
              )}
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
