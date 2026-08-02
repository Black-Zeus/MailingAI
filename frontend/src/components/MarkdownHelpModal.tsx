interface MarkdownHelpModalProps {
  open: boolean
  onClose: () => void
}

const EXAMPLES: Array<{ syntax: string; result: string }> = [
  { syntax: '# Título grande', result: 'Encabezado nivel 1' },
  { syntax: '## Título mediano', result: 'Encabezado nivel 2' },
  { syntax: '### Título chico', result: 'Encabezado nivel 3' },
  { syntax: '**texto en negrita**', result: 'texto en negrita' },
  { syntax: '*texto en cursiva*', result: 'texto en cursiva' },
  { syntax: '<u>texto subrayado</u>', result: 'texto subrayado' },
  { syntax: '- primer ítem\n- segundo ítem', result: 'Lista con viñetas' },
  { syntax: '1. primer paso\n2. segundo paso', result: 'Lista numerada' },
  { syntax: '> texto citado', result: 'Cita (bloque destacado)' },
  { syntax: '`código en línea`', result: 'código en línea' },
  { syntax: '```\nbloque de código\n```', result: 'Bloque de código' },
  { syntax: '[texto del enlace](https://ejemplo.cl)', result: 'Enlace' },
]

export function MarkdownHelpModal({ open, onClose }: MarkdownHelpModalProps) {
  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal wide">
        <div className="modal-body">
          <h3>Formato Markdown</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            Estos campos admiten Markdown — se convierte a formato visual al guardar o al enviar. Referencia rápida
            de lo más usado:
          </p>
          <div className="panel table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Escribís</th>
                  <th>Se ve como</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLES.map((ex) => (
                  <tr key={ex.syntax}>
                    <td>
                      <code style={{ whiteSpace: 'pre-wrap' }}>{ex.syntax}</code>
                    </td>
                    <td>{ex.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
