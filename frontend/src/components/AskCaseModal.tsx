import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, askCaseQuestion } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useModalBehavior } from '../utils/modalScrollLock'
import { ActionButton } from './ActionButton'
import { LabeledButton } from './LabeledButton'
import { Send, Trash2 } from 'lucide-react'

interface QaTurn {
  question: string
  answer: string
}

function storageKey(caseId: number): string {
  return `mailingai:case-qa:${caseId}`
}

function loadHistory(caseId: number): QaTurn[] {
  try {
    const raw = window.localStorage.getItem(storageKey(caseId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(caseId: number, history: QaTurn[]) {
  try {
    window.localStorage.setItem(storageKey(caseId), JSON.stringify(history))
  } catch {
    // localStorage lleno o deshabilitado -- la conversacion sigue funcionando
    // en memoria para esta sesion, simplemente no sobrevive un reload.
  }
}

interface AskCaseModalProps {
  open: boolean
  caseId: number | null
  caseTitle: string
  onClose: () => void
}

export function AskCaseModal({ open, caseId, caseTitle, onClose }: AskCaseModalProps) {
  const titleId = useId()
  const modalRef = useModalBehavior(open, onClose)
  const { showToast } = useToast()
  const [history, setHistory] = useState<QaTurn[]>([])
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || caseId === null) return
    setHistory(loadHistory(caseId))
    setDraft('')
  }, [open, caseId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [history, asking])

  async function handleSend() {
    const question = draft.trim()
    if (!question || caseId === null) return
    setAsking(true)
    try {
      const result = await askCaseQuestion(caseId, question)
      const next = [...history, { question, answer: result.answer }]
      setHistory(next)
      saveHistory(caseId, next)
      setDraft('')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo responder la pregunta.', true)
    } finally {
      setAsking(false)
    }
  }

  function handleClearHistory() {
    if (caseId === null) return
    setHistory([])
    saveHistory(caseId, [])
  }

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      {caseId !== null && (
        <div className="modal wide" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <h3 id={titleId} style={{ margin: 0 }}>Consultar expediente</h3>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{caseTitle}</p>
              </div>
              <ActionButton
                icon={Trash2}
                label="Limpiar conversación"
                variant="danger"
                disabled={history.length === 0}
                onClick={handleClearHistory}
              />
            </div>
            <p className="text-muted" style={{ fontSize: 11.5, marginTop: 4, marginBottom: 12 }}>
              La respuesta se arma solo con el contenido de los correos de este expediente. La conversación queda
              guardada en este navegador (no en el servidor) — se pierde si la borrás desde acá o cambiás de
              navegador.
            </p>
            <div
              ref={scrollRef}
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {history.length === 0 && !asking && (
                <p className="text-muted" style={{ fontSize: 12.5 }}>
                  Todavía no hiciste ninguna pregunta sobre este expediente.
                </p>
              )}
              {history.map((qa, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      alignSelf: 'flex-end',
                      maxWidth: '80%',
                      background: 'var(--accent-2)',
                      color: 'var(--on-accent-text)',
                      borderRadius: '12px 12px 2px 12px',
                      padding: '9px 13px',
                      fontSize: 13,
                    }}
                  >
                    {qa.question}
                  </div>
                  <div
                    style={{
                      alignSelf: 'flex-start',
                      maxWidth: '80%',
                      background: 'var(--panel-2)',
                      border: '1px solid var(--line)',
                      borderRadius: '12px 12px 12px 2px',
                      padding: '9px 13px',
                      fontSize: 13,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {qa.answer}
                  </div>
                </div>
              ))}
              {asking && <p className="text-muted" style={{ fontSize: 12.5 }}>Pensando…</p>}
            </div>
          </div>
          <div className="modal-actions">
            <input
              type="text"
              aria-label="Pregunta para la IA"
              placeholder='ej. "¿Cuál es el estado actual?" o "¿Qué se acordó con el remitente?"'
              value={draft}
              disabled={asking}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              style={{ flex: 1 }}
            />
            <ActionButton icon={Send} label="Enviar" variant="primary" loading={asking} disabled={!draft.trim()} onClick={handleSend} />
            <LabeledButton onClick={onClose}>✕ Cerrar</LabeledButton>
          </div>
        </div>
      )}
    </div>
  )
}
