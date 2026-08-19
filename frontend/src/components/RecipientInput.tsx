import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { ApiError, searchContacts } from '../api/client'
import type { ContactRead } from '../types/messages'

interface RecipientInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DRAG_MIME = 'application/x-mailingai-recipient'

function parseChips(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Autocompletar Para/CC al estilo Outlook/Gmail web: mientras se escribe se
// buscan coincidencias contra la libreta de direcciones derivada de los
// correos ya indexados (ver /api/contacts/search); al elegir una, o al
// tipear un correo valido y confirmar con Enter/coma/Tab, queda como un
// "chip" removible. El valor que ve el resto del formulario sigue siendo el
// mismo string separado por comas de siempre (sendEmailForm.to/cc) -- este
// componente solo cambia como se edita, no el contrato con el backend.
//
// Los chips son arrastrables: soltar sobre otro chip del MISMO campo lo
// reordena; soltar sobre un chip (o el area vacia) de OTRA instancia de este
// componente (ej. de "Para" a "CC") lo mueve para alla. La comunicacion
// entre las dos instancias -- que no comparten estado React -- va por el
// dataTransfer nativo del drag, taggeado con un instanceId (useId) para que
// cada instancia sepa si el drop es "reordenarme a mi mismo" o "me llega uno
// de afuera" sin necesidad de un store compartido.
export function RecipientInput({ id, value, onChange, placeholder, disabled }: RecipientInputProps) {
  const [inputText, setInputText] = useState('')
  const [suggestions, setSuggestions] = useState<ContactRead[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [draggingEmail, setDraggingEmail] = useState<string | null>(null)
  const nameCacheRef = useRef<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // true si el ultimo drop lo resolvio el onDrop de esta MISMA instancia como
  // reordenamiento interno (remove+insert atomico) -- le avisa al onDragEnd
  // del chip de origen que no tiene que borrar nada de nuevo.
  const selfReorderedRef = useRef(false)
  const instanceId = useId()

  const chips = parseChips(value)

  useEffect(() => {
    const query = inputText.trim()
    if (query.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const results = await searchContacts(query)
        if (cancelled) return
        for (const r of results) {
          if (r.name) nameCacheRef.current[r.email.toLowerCase()] = r.name
        }
        // No reofrecer direcciones que ya son un chip.
        const chipSet = new Set(chips.map((c) => c.toLowerCase()))
        setSuggestions(results.filter((r) => !chipSet.has(r.email.toLowerCase())))
        setHighlighted(0)
        setOpen(true)
      } catch (err) {
        if (!cancelled && !(err instanceof ApiError)) throw err
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText])

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  function addChip(email: string) {
    const trimmed = email.trim()
    if (!trimmed) return
    if (chips.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setInputText('')
      setOpen(false)
      return
    }
    onChange([...chips, trimmed].join(', '))
    setInputText('')
    setSuggestions([])
    setOpen(false)
  }

  function removeChip(email: string) {
    onChange(chips.filter((c) => c.toLowerCase() !== email.toLowerCase()).join(', '))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open && suggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setHighlighted((prev) => {
        const next = e.key === 'ArrowDown' ? prev + 1 : prev - 1
        return (next + suggestions.length) % suggestions.length
      })
      return
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (open && suggestions.length > 0) {
        e.preventDefault()
        addChip(suggestions[highlighted].email)
        return
      }
      if (inputText.trim() && EMAIL_RE.test(inputText.trim())) {
        e.preventDefault()
        addChip(inputText)
      }
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Backspace' && inputText === '' && chips.length > 0) {
      removeChip(chips[chips.length - 1])
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    const parts = pasted.split(/[,;\s\n]+/).map((s) => s.trim()).filter(Boolean)
    const emails = parts.filter((p) => EMAIL_RE.test(p))
    if (emails.length === 0) return
    e.preventDefault()
    const merged = [...chips]
    for (const email of emails) {
      if (!merged.some((c) => c.toLowerCase() === email.toLowerCase())) merged.push(email)
    }
    onChange(merged.join(', '))
    setInputText('')
  }

  function handleBlur() {
    const trimmed = inputText.trim()
    if (trimmed && EMAIL_RE.test(trimmed)) addChip(trimmed)
    setTimeout(() => setOpen(false), 120)
  }

  function handleChipDragStart(e: DragEvent<HTMLSpanElement>, email: string) {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ email, sourceId: instanceId }))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingEmail(email)
  }

  function handleChipDragEnd(e: DragEvent<HTMLSpanElement>, email: string) {
    setDraggingEmail(null)
    if (selfReorderedRef.current) {
      selfReorderedRef.current = false
      return
    }
    // dropEffect solo queda en 'move' si algun onDragOver de un drop target
    // valido lo seteo asi -- si el usuario soltó afuera de cualquier chip/
    // contenedor valido, queda en 'none' y no se borra de donde estaba.
    if (e.dataTransfer.dropEffect === 'move') removeChip(email)
  }

  function handleDragOver(e: DragEvent) {
    if (disabled) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(e: DragEvent, targetEmail: string | null) {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    let payload: { email: string; sourceId: string }
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    const draggedEmail = payload.email
    if (targetEmail && draggedEmail.toLowerCase() === targetEmail.toLowerCase()) return

    const withoutDragged = chips.filter((c) => c.toLowerCase() !== draggedEmail.toLowerCase())
    const targetIdx = targetEmail
      ? withoutDragged.findIndex((c) => c.toLowerCase() === targetEmail.toLowerCase())
      : -1
    const insertAt = targetIdx === -1 ? withoutDragged.length : targetIdx
    const next = [...withoutDragged]
    next.splice(insertAt, 0, draggedEmail)
    onChange(next.join(', '))

    if (payload.sourceId === instanceId) selfReorderedRef.current = true
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        className="recipient-input"
        onClick={() => inputRef.current?.focus()}
        aria-disabled={disabled}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, null)}
      >
        {chips.map((email) => {
          const name = nameCacheRef.current[email.toLowerCase()]
          return (
            <span
              className={`recipient-chip${draggingEmail === email ? ' dragging' : ''}`}
              key={email}
              title={name ? email : undefined}
              draggable={!disabled}
              onDragStart={(e) => handleChipDragStart(e, email)}
              onDragEnd={(e) => handleChipDragEnd(e, email)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, email)}
            >
              {name ?? email}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Quitar ${email}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeChip(email)
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          )
        })}
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={inputText}
          disabled={disabled}
          placeholder={chips.length === 0 ? placeholder : ''}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={handleBlur}
          autoComplete="off"
        />
      </div>
      {open && (loading || suggestions.length > 0) && (
        <div className="recipient-suggestions">
          {loading && suggestions.length === 0 && (
            <div className="recipient-suggestion-empty">Buscando…</div>
          )}
          {suggestions.map((s, idx) => (
            <div
              key={s.email}
              className={`recipient-suggestion${idx === highlighted ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                addChip(s.email)
              }}
              onMouseEnter={() => setHighlighted(idx)}
            >
              {s.name && <strong>{s.name}</strong>}
              <span>{s.email}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
