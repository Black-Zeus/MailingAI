import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { ActionButton } from './ActionButton'
import type { PendingActionPresetRead } from '../types/pendingActionPresets'

// Solo el panel desplegable -- el boton que lo abre/cierra queda en
// CasesView.tsx, dentro del <label> de "Acciones pendientes" (mismo flex
// row que el boton de ayuda de Markdown). Mantenerlo afuera evita que este
// panel (bloque, con su propio padding/margin) termine forzado como item de
// ese flex row.
export function PendingActionPresetsPanel({
  presets,
  adding,
  deletingId,
  disabled,
  onAdd,
  onDelete,
  onInsert,
}: {
  presets: PendingActionPresetRead[]
  adding: boolean
  deletingId: number | null
  disabled?: boolean
  onAdd: (text: string) => void | Promise<void>
  onDelete: (presetId: number) => void
  onInsert: (text: string) => void
}) {
  const [newText, setNewText] = useState('')

  async function handleAdd() {
    const text = newText.trim()
    if (!text) return
    await onAdd(text)
    setNewText('')
  }

  return (
    <div className="panel" style={{ marginBottom: 8, padding: 10 }}>
      {presets.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Todavía no hay frases guardadas.</p>
      )}
      {presets.map((preset) => (
        <div key={preset.preset_id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <button
            type="button"
            className="btn small"
            style={{ flex: 1, textAlign: 'left', whiteSpace: 'normal' }}
            disabled={disabled}
            onClick={() => onInsert(preset.text)}
          >
            {preset.text}
          </button>
          <ActionButton
            icon={X}
            label="Borrar frase"
            size="sm"
            loading={deletingId === preset.preset_id}
            onClick={() => onDelete(preset.preset_id)}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          type="text"
          placeholder="Nueva frase para agregar a la lista…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          style={{ flex: 1 }}
        />
        <ActionButton
          icon={Plus}
          label={adding ? 'Agregando…' : 'Agregar'}
          variant="primary"
          loading={adding}
          disabled={!newText.trim()}
          onClick={handleAdd}
        />
      </div>
    </div>
  )
}
