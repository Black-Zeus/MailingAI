import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { EXCLUSION_RULE_FIELD_LABELS } from '../types/cases'
import type { ExclusionRuleFields, ExclusionRuleRead } from '../types/cases'

const FIELD_KEYS = Object.keys(EXCLUSION_RULE_FIELD_LABELS) as (keyof ExclusionRuleFields)[]

const EMPTY_FIELDS: ExclusionRuleFields = {
  match_subject: false,
  match_body: false,
  match_from: false,
  match_to: false,
  match_cc: false,
  match_attachment: false,
}

interface ExclusionRuleManagerProps {
  rules: ExclusionRuleRead[]
  onCreate: (pattern: string, fields: ExclusionRuleFields) => Promise<void>
  onToggle: (rule: ExclusionRuleRead) => void
  onDelete: (rule: ExclusionRuleRead) => void
  togglingId?: number | null
  deletingId?: number | null
  initialPattern?: string
  initialFields?: Partial<ExclusionRuleFields>
  idPrefix: string
}

// Reusado en Configuracion (reglas globales, por usuario) y en el detalle de
// expediente (reglas locales) -- misma forma para ambos alcances, solo
// cambia que endpoint las lista/crea/toca (ver client.ts). Sin regla
// "guardada" no hay forma de que un correo ruidoso deje de sugerirse solo:
// esto es lo que evita tener que repetir la exclusion puntual (bulkRemove)
// expediente tras expediente.
export function ExclusionRuleManager({
  rules,
  onCreate,
  onToggle,
  onDelete,
  togglingId = null,
  deletingId = null,
  initialPattern = '',
  initialFields,
  idPrefix,
}: ExclusionRuleManagerProps) {
  const [pattern, setPattern] = useState(initialPattern)
  const [fields, setFields] = useState<ExclusionRuleFields>({ ...EMPTY_FIELDS, ...initialFields })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasAnyField = FIELD_KEYS.some((key) => fields[key])

  async function handleSubmit() {
    if (!pattern.trim() || !hasAnyField) {
      setError(!pattern.trim() ? 'El patrón no puede estar vacío.' : 'Elegí al menos un campo.')
      return
    }
    setError(null)
    setCreating(true)
    try {
      await onCreate(pattern.trim(), fields)
      setPattern('')
      setFields({ ...EMPTY_FIELDS })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      {rules.length > 0 && (
        <div className="table-wrap mt-4">
          <table className="table-wide">
            <thead>
              <tr>
                <th scope="col">Patrón</th>
                <th scope="col">Aplica a</th>
                <th scope="col" style={{ width: 90 }}>
                  Estado
                </th>
                <th scope="col" style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.rule_id}>
                  <td className="mono">{rule.pattern}</td>
                  <td>{FIELD_KEYS.filter((key) => rule[key]).map((key) => EXCLUSION_RULE_FIELD_LABELS[key]).join(', ')}</td>
                  <td>
                    <button
                      type="button"
                      className={`badge ${rule.enabled ? 'success' : 'cancelled'}`}
                      style={{ border: 'none', cursor: togglingId === rule.rule_id ? 'default' : 'pointer' }}
                      disabled={togglingId === rule.rule_id}
                      onClick={() => onToggle(rule)}
                      title={rule.enabled ? 'Click para desactivar' : 'Click para activar'}
                    >
                      {togglingId === rule.rule_id ? '…' : rule.enabled ? 'Activa' : 'Inactiva'}
                    </button>
                  </td>
                  <td>
                    <ActionButton
                      icon={Trash2}
                      label="Eliminar regla"
                      variant="danger"
                      loading={deletingId === rule.rule_id}
                      onClick={() => onDelete(rule)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="field full mt-4">
        <label htmlFor={`${idPrefix}-pattern`}>Nueva regla — texto a buscar</label>
        <input
          id={`${idPrefix}-pattern`}
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder='ej. "Boletín semanal automático"'
        />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '6px 0' }}>
        {FIELD_KEYS.map((key) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={fields[key]}
              onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            {EXCLUSION_RULE_FIELD_LABELS[key]}
          </label>
        ))}
      </div>
      {error && (
        <p style={{ color: 'var(--error-text)', fontSize: 12, margin: '0 0 6px' }}>
          {error}
        </p>
      )}
      <button type="button" className="btn small btn-labeled" onClick={handleSubmit} disabled={creating}>
        {creating ? 'Guardando…' : '+ Crear regla'}
      </button>
    </div>
  )
}
