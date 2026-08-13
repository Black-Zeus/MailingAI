import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, askCaseQuestion } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useModalBehavior } from '../utils/modalScrollLock'
import { ActionButton } from './ActionButton'
import { LabeledButton } from './LabeledButton'
import { Send, Trash2 } from 'lucide-react'

interface QaTurn {
  question: string
  // null mientras la respuesta esta en vuelo -- ver loadHistory para por que
  // nunca deberia persistir asi entre sesiones.
  answer: string | null
  error?: boolean
  // true si el expediente no entraba completo en el contexto del modelo y la
  // respuesta se armo con los fragmentos mas relevantes en vez del contenido
  // completo -- a diferencia del contexto completo, un fallo de recall aca
  // es invisible para el modelo, asi que vale la pena que el auditor lo sepa.
  usedRetrieval?: boolean
}

function storageKey(caseId: number): string {
  return `mailingai:case-qa:${caseId}`
}

function loadHistory(caseId: number): QaTurn[] {
  try {
    const raw = window.localStorage.getItem(storageKey(caseId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Un turno con answer=null solo puede venir de una pregunta que quedo en
    // vuelo cuando se cerro el modal o se recargo la pagina -- ninguna
    // request sigue corriendo a esta altura, asi que se marca como
    // interrumpida en vez de mostrar un "Pensando..." que nunca va a resolver.
    return (parsed as QaTurn[]).map((turn) =>
      turn.answer === null
        ? { ...turn, answer: 'La consulta se interrumpió antes de recibir respuesta.', error: true }
        : turn
    )
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
    setDraft('')
    setAsking(true)
    // La pregunta entra al historial (y se persiste) apenas se envia, no
    // recien cuando llega la respuesta -- asi si el modelo tarda, falla, o el
    // usuario cierra el modal antes de que termine, la pregunta ya quedo
    // reflejada en el chat en vez de perderse en silencio.
    const pendingIndex = history.length
    const withPending: QaTurn[] = [...history, { question, answer: null }]
    setHistory(withPending)
    saveHistory(caseId, withPending)
    try {
      const result = await askCaseQuestion(caseId, question)
      const next = withPending.map((turn, idx) =>
        idx === pendingIndex ? { question, answer: result.answer, usedRetrieval: result.used_retrieval } : turn
      )
      setHistory(next)
      saveHistory(caseId, next)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No se pudo responder la pregunta.'
      const next = withPending.map((turn, idx) =>
        idx === pendingIndex ? { question, answer: message, error: true } : turn
      )
      setHistory(next)
      saveHistory(caseId, next)
      showToast(message, true)
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
              {history.length === 0 && (
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
                  {qa.answer === null ? (
                    <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>Pensando…</p>
                  ) : (
                    <div style={{ alignSelf: 'flex-start', maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div
                        style={{
                          background: qa.error ? 'rgba(255, 107, 122, 0.1)' : 'var(--panel-2)',
                          border: qa.error ? '1px solid rgba(255, 107, 122, 0.5)' : '1px solid var(--line)',
                          color: qa.error ? 'var(--error-text)' : undefined,
                          borderRadius: '12px 12px 12px 2px',
                          padding: '9px 13px',
                          fontSize: 13,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {qa.answer}
                      </div>
                      {qa.usedRetrieval && !qa.error && (
                        <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
                          ⚠ Expediente extenso: respuesta armada con los fragmentos más relevantes, no con el
                          contenido completo — si no encontrás lo que buscabas, revisá el expediente a mano.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
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
