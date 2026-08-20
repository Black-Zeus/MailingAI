import { Bot, Check, HelpCircle, Plus, RefreshCw, Save, X } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { PendingActionPresetsPanel } from './PendingActionPresetsPanel'
import type { PendingActionPresetsState } from '../utils/usePendingActionPresets'

// Panel "Seguimiento del expediente" (pending_action/next_review/closing_glosa).
// Deliberadamente NO incluye "Conclusión de la revisión" (outcome/alert_type)
// aunque el hallazgo original de la auditoria los agrupaba: en el DOM real
// quedan separados por el bloque de "Agregar correo puntual", asi que
// juntarlos hubiera obligado a mover tambien esa tercera funcionalidad,
// sin relacion con el seguimiento.
export function FollowUpPanel({
  caseId,
  isClosed,
  pendingAction,
  onPendingActionChange,
  presetsMenuOpen,
  onTogglePresetsMenu,
  presets,
  onInsertPreset,
  onOpenMarkdownHelp,
  nextReview,
  onNextReviewChange,
  closingGlosa,
  onClosingGlosaChange,
  summarizingGlosa,
  onSummarizeGlosa,
  glosaSuggestion,
  onAcceptGlosaSuggestion,
  onRejectGlosaSuggestion,
  savingFollowUp,
  onSaveFollowUp,
}: {
  caseId: number
  isClosed: boolean
  pendingAction: string
  onPendingActionChange: (value: string) => void
  presetsMenuOpen: boolean
  onTogglePresetsMenu: () => void
  presets: PendingActionPresetsState
  onInsertPreset: (text: string) => void
  onOpenMarkdownHelp: () => void
  nextReview: string
  onNextReviewChange: (value: string) => void
  closingGlosa: string
  onClosingGlosaChange: (value: string) => void
  summarizingGlosa: boolean
  onSummarizeGlosa: () => void
  glosaSuggestion: string | undefined
  onAcceptGlosaSuggestion: () => void
  onRejectGlosaSuggestion: () => void
  savingFollowUp: boolean
  onSaveFollowUp: () => void
}) {
  return (
    <div className="ai-result">
      <h5 style={{ margin: '0 0 8px' }}>📋 Seguimiento del expediente</h5>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`case-pending-action-${caseId}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Acciones pendientes
            <ActionButton icon={HelpCircle} label="Ayuda de formato Markdown" size="sm" onClick={onOpenMarkdownHelp} />
            <ActionButton
              icon={Plus}
              label="Frases predefinidas"
              size="sm"
              disabled={isClosed}
              onClick={onTogglePresetsMenu}
            />
          </label>
          {presetsMenuOpen && (
            <PendingActionPresetsPanel
              presets={presets.presets}
              adding={presets.adding}
              deletingId={presets.deletingId}
              disabled={isClosed}
              onAdd={presets.addPreset}
              onDelete={presets.deletePreset}
              onInsert={onInsertPreset}
            />
          )}
          <textarea
            id={`case-pending-action-${caseId}`}
            placeholder="Qué falta hacer sobre este expediente… (admite formato Markdown, se convierte a HTML en el PDF exportado)"
            value={pendingAction}
            onChange={(e) => onPendingActionChange(e.target.value)}
            rows={4}
            style={{ width: '100%', resize: 'vertical' }}
            disabled={isClosed}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`case-next-review-${caseId}`}>Próxima revisión</label>
          <input
            id={`case-next-review-${caseId}`}
            type="date"
            value={nextReview}
            onChange={(e) => onNextReviewChange(e.target.value)}
            disabled={isClosed}
          />
        </div>
      </div>
      <div className="field" style={{ margin: '10px 0 0' }}>
        <label htmlFor={`case-closing-glosa-${caseId}`}>Glosa de cierre (obligatoria para cerrar el expediente)</label>
        <textarea
          id={`case-closing-glosa-${caseId}`}
          placeholder="Motivo del cierre: escalado, derivado, se solicita el cierre por falta de evidencia, ya se entregó, se solicita una acción puntual…"
          value={closingGlosa}
          onChange={(e) => onClosingGlosaChange(e.target.value)}
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
          disabled={isClosed}
        />
        <div style={{ marginTop: 6 }}>
          <ActionButton
            icon={Bot}
            label={summarizingGlosa ? 'Resumiendo…' : 'Resumir con IA'}
            size="sm"
            loading={summarizingGlosa}
            disabled={isClosed || !closingGlosa.trim()}
            onClick={onSummarizeGlosa}
          />
        </div>
        {glosaSuggestion && (
          <div className="panel" style={{ marginTop: 8, padding: 10 }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--muted)' }}>
              Sugerencia de IA — revisa antes de aceptar:
            </p>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 8 }}>{glosaSuggestion}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <ActionButton icon={Check} label="Aceptar" size="sm" variant="primary" onClick={onAcceptGlosaSuggestion} />
              <ActionButton icon={X} label="Rechazar" size="sm" onClick={onRejectGlosaSuggestion} />
              <ActionButton
                icon={RefreshCw}
                label={summarizingGlosa ? 'Reiterando…' : 'Reiterar'}
                size="sm"
                loading={summarizingGlosa}
                onClick={onSummarizeGlosa}
              />
            </div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <ActionButton
          icon={Save}
          label={savingFollowUp ? 'Guardando…' : 'Guardar seguimiento'}
          variant="primary"
          loading={savingFollowUp}
          disabled={isClosed}
          onClick={onSaveFollowUp}
        />
      </div>
    </div>
  )
}
