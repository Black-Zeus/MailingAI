import { useId } from 'react'
import { Copy } from 'lucide-react'
import { useModalBehavior } from '../utils/modalScrollLock'
import { useToast } from '../context/ToastContext'
import { ActionButton } from './ActionButton'
import { LabeledButton } from './LabeledButton'

interface MarkdownHelpModalProps {
  open: boolean
  onClose: () => void
}

// resultHtml es HTML real (no una descripcion en texto) -- se muestra tal
// cual con dangerouslySetInnerHTML para que la columna "Se ve como" sea la
// representacion visual de verdad, no una etiqueta que la explica. Seguro
// porque son strings fijas escritas a mano aca, nunca contenido de usuario.
//
// Esta lista refleja exactamente lo que backend/app/services/markdown_render.py
// soporta: python-markdown con extensions=["extra", "sane_lists"], pasado
// despues por bleach.clean con una lista fija de tags permitidos
// (_ALLOWED_TAGS). "extra" en si mismo parsea mas cosas de las que quedan acá
// (definiciones, notas al pie, abreviaturas) pero sus tags (<dl>, <sup>,
// <abbr>, <div>...) NO estan en _ALLOWED_TAGS, asi que bleach las saca y el
// resultado no se ve distinto de texto plano -- por eso no se listan como
// soportadas aunque el parser "las entienda".
const EXAMPLES: Array<{ syntax: string; resultHtml: string }> = [
  { syntax: '# Título grande', resultHtml: '<h1 style="margin:0;font-size:1.3em;">Título grande</h1>' },
  { syntax: '## Título mediano', resultHtml: '<h2 style="margin:0;font-size:1.15em;">Título mediano</h2>' },
  { syntax: '### Título chico', resultHtml: '<h3 style="margin:0;font-size:1.05em;">Título chico</h3>' },
  { syntax: '**texto en negrita**', resultHtml: '<strong>texto en negrita</strong>' },
  { syntax: '*texto en cursiva*', resultHtml: '<em>texto en cursiva</em>' },
  { syntax: '<u>texto subrayado</u>', resultHtml: '<u>texto subrayado</u>' },
  // ~~texto~~ (la sintaxis Markdown "estandar" de tachado) NO esta soportada
  // -- ninguna extension habilitada la parsea, queda como texto literal con
  // los guiones. Lo que SI funciona es la etiqueta HTML cruda <s>, igual que
  // <u> arriba (bleach la permite, sane_lists/extra no interfieren).
  { syntax: '<s>texto tachado</s>', resultHtml: '<s>texto tachado</s>' },
  {
    syntax: '- primer ítem\n- segundo ítem',
    resultHtml: '<ul style="margin:0;padding-left:18px;"><li>primer ítem</li><li>segundo ítem</li></ul>',
  },
  {
    syntax: '1. primer paso\n2. segundo paso',
    resultHtml: '<ol style="margin:0;padding-left:18px;"><li>primer paso</li><li>segundo paso</li></ol>',
  },
  {
    syntax: '> texto citado',
    resultHtml:
      '<blockquote style="margin:0;padding-left:10px;border-left:2px solid var(--line);color:var(--muted);">texto citado</blockquote>',
  },
  { syntax: '`código en línea`', resultHtml: '<code>código en línea</code>' },
  {
    syntax: '```\nbloque de código\n```',
    resultHtml:
      '<pre style="margin:0;padding:6px 8px;background:var(--panel-2);border-radius:6px;overflow-x:auto;"><code>bloque de código</code></pre>',
  },
  {
    syntax: '[texto del enlace](https://ejemplo.cl)',
    resultHtml: '<a href="https://ejemplo.cl" target="_blank" rel="noreferrer">texto del enlace</a>',
  },
  {
    syntax: '---',
    resultHtml: '<hr style="margin:0;border:none;border-top:1px solid var(--line);" />',
  },
  {
    syntax: '| Col A | Col B |\n|-------|-------|\n| uno   | dos   |',
    resultHtml:
      '<table style="margin:0;font-size:0.95em;"><thead><tr><th style="text-align:left;padding-right:10px;">Col A</th><th style="text-align:left;">Col B</th></tr></thead><tbody><tr><td style="padding-right:10px;">uno</td><td>dos</td></tr></tbody></table>',
  },
]

// Cosas que python-markdown/extra SI reconoce como sintaxis, pero que
// terminan sin efecto visible porque bleach saca el tag que generan
// (no estan en _ALLOWED_TAGS) -- se documentan aca para no dejar la duda.
const NOT_SUPPORTED = [
  'Imágenes: ![alt](url) — se elimina la etiqueta que genera, no se muestra ninguna imagen.',
  'Notas al pie: texto[^1] — se elimina el superíndice y la lista de notas, queda solo el texto.',
  'Listas de definición: Término / : Definición — se elimina la estructura, queda como texto corrido.',
  'Abreviaturas: *[HTML]: HyperText... — se elimina el tooltip, queda el texto tal cual.',
  'Atributos {: #id .clase} sobre cualquier elemento — se eliminan, no hay CSS personalizado vía Markdown.',
]

export function MarkdownHelpModal({ open, onClose }: MarkdownHelpModalProps) {
  const titleId = useId()
  const modalRef = useModalBehavior(open, onClose)
  const { showToast } = useToast()

  async function handleCopy(syntax: string) {
    try {
      await navigator.clipboard.writeText(syntax)
      showToast('Copiado al portapapeles')
    } catch {
      showToast('No se pudo copiar al portapapeles.', true)
    }
  }

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div
        className="modal wide"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-body">
          <h3 id={titleId}>Formato Markdown</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            Estos campos admiten Markdown — se convierte a formato visual al guardar o al enviar. Referencia rápida
            de lo más usado:
          </p>
          <div className="panel table-wrap mt-5">
            <table>
              <thead>
                <tr>
                  <th scope="col">Escribís</th>
                  <th scope="col">Se ve como</th>
                  <th scope="col" style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLES.map((ex) => (
                  <tr key={ex.syntax}>
                    <td>
                      <code style={{ whiteSpace: 'pre-wrap' }}>{ex.syntax}</code>
                    </td>
                    <td className="md-content" dangerouslySetInnerHTML={{ __html: ex.resultHtml }} />
                    <td>
                      <ActionButton icon={Copy} label="Copiar" size="sm" onClick={() => handleCopy(ex.syntax)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '14px 0 4px' }}>
            No soportado (el parser puede reconocer la sintaxis, pero el resultado se limpia por seguridad y queda
            como texto plano):
          </p>
          <ul style={{ color: 'var(--muted)', fontSize: 12, margin: 0, paddingLeft: 18 }}>
            {NOT_SUPPORTED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="modal-actions">
          <LabeledButton size="sm" onClick={onClose}>✕ Cerrar</LabeledButton>
        </div>
      </div>
    </div>
  )
}
