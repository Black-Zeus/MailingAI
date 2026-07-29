import { useBodyScrollLock } from '../utils/modalScrollLock'

// El HTML del correo viene de Graph, no es contenido nuestro -- se muestra en
// un iframe sandboxed sin "allow-scripts" para que nada de ese HTML pueda
// ejecutar JS ni acceder al resto de la pagina, sin depender de una libreria
// de sanitizado aparte.
export function MessageBodyView({ content, contentType }: { content: string; contentType: string }) {
  if (contentType === 'html') {
    return (
      <iframe
        title="Cuerpo del correo"
        srcDoc={content}
        sandbox="allow-same-origin"
        style={{
          width: '100%',
          flex: 1,
          minHeight: 260,
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: '#fff',
        }}
      />
    )
  }
  return <div className="message-body">{content}</div>
}

export interface MessageBodyModalState {
  subject: string
  bodyContent: string | null
  bodyContentType: string
  bodyPreview: string | null
  webLink: string | null
}

export function MessageBodyModal({
  state,
  onClose,
}: {
  state: MessageBodyModalState | null
  onClose: () => void
}) {
  useBodyScrollLock(state !== null)
  return (
    <div className={`modal-backdrop${state ? ' open' : ''}`}>
      <div className="modal wide">
        <div className="modal-body">
          <h3>{state?.subject}</h3>
          {state &&
            (state.bodyContent ? (
              <MessageBodyView content={state.bodyContent} contentType={state.bodyContentType} />
            ) : (
              <div className="message-body muted">
                Este mensaje se trajo antes de guardar el cuerpo completo — solo hay un recorte corto:
                <br />
                {state.bodyPreview}
              </div>
            ))}
        </div>
        <div className="modal-actions">
          {state?.webLink && (
            <a href={state.webLink} target="_blank" rel="noreferrer" className="btn small btn-labeled">
              🔗 Ver correo
            </a>
          )}
          <button type="button" className="btn small btn-labeled" onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
