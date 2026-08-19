import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  ApiError,
  createMailTemplate,
  deleteMailTemplate,
  listMailTemplates,
  updateMailTemplate,
} from '../api/client'
import type { MailTemplateRead } from '../types/mailTemplates'
import { AUTO_VARIABLES } from '../types/mailTemplates'
import { ActionButton } from '../components/ActionButton'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../context/ToastContext'

interface FormState {
  name: string
  subject_template: string
  body_template: string
}

const EMPTY_FORM: FormState = { name: '', subject_template: '', body_template: '' }

export function MailTemplatesView() {
  const { showToast } = useToast()
  const [templates, setTemplates] = useState<MailTemplateRead[] | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MailTemplateRead | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function loadTemplates() {
    try {
      setTemplates(await listMailTemplates())
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar las plantillas.', true)
    }
  }

  useEffect(() => {
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditForm(template: MailTemplateRead) {
    setEditingId(template.template_id)
    setForm({
      name: template.name,
      subject_template: template.subject_template,
      body_template: template.body_template,
    })
    setFormOpen(true)
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.subject_template.trim() || !form.body_template.trim()) {
      showToast('Completa nombre, asunto y cuerpo.', true)
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        subject_template: form.subject_template.trim(),
        body_template: form.body_template,
      }
      if (editingId) {
        await updateMailTemplate(editingId, payload)
        showToast('Plantilla actualizada')
      } else {
        await createMailTemplate(payload)
        showToast('Plantilla creada')
      }
      setFormOpen(false)
      await loadTemplates()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo guardar la plantilla.', true)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(template: MailTemplateRead) {
    setTogglingId(template.template_id)
    try {
      await updateMailTemplate(template.template_id, { active: !template.active })
      await loadTemplates()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado de la plantilla.', true)
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteMailTemplate(deleteTarget.template_id)
      showToast('Plantilla eliminada')
      setDeleteTarget(null)
      await loadTemplates()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar la plantilla.', true)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Plantillas de correo</h2>
          <p>
            Se usan para reportar expedientes cerrados por correo — compartidas para todo el equipo. Cualquier{' '}
            <code>[TEXTO]</code> que no sea una variable automática se pide como campo manual al generar el reporte.
          </p>
        </div>
        <button type="button" className="btn primary btn-labeled" onClick={openCreateForm}>
          ＋ Nueva plantilla
        </button>
      </div>

      <div className="panel table-wrap">
        <table className="table-wide">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Asunto</th>
              <th scope="col" style={{ width: 90 }}>
                Estado
              </th>
              <th scope="col" style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {templates !== null && templates.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-view">
                  No hay plantillas creadas todavía.
                </td>
              </tr>
            )}
            {templates?.map((t) => (
              <tr key={t.template_id}>
                <td>{t.name}</td>
                <td className="mono">{t.subject_template}</td>
                <td>
                  <button
                    type="button"
                    className={`badge ${t.active ? 'success' : 'cancelled'}`}
                    style={{ border: 'none', cursor: togglingId === t.template_id ? 'default' : 'pointer' }}
                    disabled={togglingId === t.template_id}
                    onClick={() => handleToggleActive(t)}
                    title={t.active ? 'Click para desactivar' : 'Click para activar'}
                  >
                    {togglingId === t.template_id ? '…' : t.active ? 'Activa' : 'Inactiva'}
                  </button>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn small btn-labeled" onClick={() => openEditForm(t)}>
                      ✎ Editar
                    </button>
                    <ActionButton icon={Trash2} label="Eliminar plantilla" variant="danger" onClick={() => setDeleteTarget(t)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`modal-backdrop${formOpen ? ' open' : ''}`}>
        <div className="modal medium">
          <div className="modal-body">
            <h3>{editingId ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
            <div className="form-grid mt-6">
              <div className="field full">
                <label htmlFor="tpl-name">Nombre</label>
                <input
                  id="tpl-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="ej. Reporte estándar CyberSOC"
                />
              </div>
              <div className="field full">
                <label htmlFor="tpl-subject">Asunto</label>
                <input
                  id="tpl-subject"
                  type="text"
                  value={form.subject_template}
                  onChange={(e) => setForm((f) => ({ ...f, subject_template: e.target.value }))}
                  placeholder="ej. RE: [CODIGO] - [TIPO_DE_ALERTA]"
                />
              </div>
              <div className="field full">
                <label htmlFor="tpl-body">Cuerpo (Markdown)</label>
                <textarea
                  id="tpl-body"
                  rows={12}
                  value={form.body_template}
                  onChange={(e) => setForm((f) => ({ ...f, body_template: e.target.value }))}
                  placeholder={
                    'Validación: [VALIDACION]\n\nAcción: [ACCION]\n\nEvidencia: [EVIDENCIA]\n\nEstado: [ESTADO]\n\nSiguiente acción: [SIGUIENTE_ACCION]'
                  }
                />
              </div>
              <div className="field full">
                <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>
                  Variables automáticas disponibles (se completan solas con datos del expediente):
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {AUTO_VARIABLES.map((v) => (
                    <span key={v.name} className="badge queued" title={v.description}>
                      [{v.name}]
                    </span>
                  ))}
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 0' }}>
                  Cualquier otro <code>[TEXTO]</code> que escribas (ej. <code>[VALIDACION]</code>) se pedirá como
                  campo manual al generar el reporte de un expediente.
                </p>
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn small btn-labeled" onClick={() => setFormOpen(false)}>
              ✕ Cancelar
            </button>
            <button type="button" className="btn primary btn-labeled" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Guardando…' : editingId ? '✓ Guardar cambios' : '＋ Crear plantilla'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Eliminar plantilla"
        description={deleteTarget ? `Se elimina la plantilla "${deleteTarget.name}" para todo el equipo.` : ''}
        confirmLabel="Eliminar plantilla"
        confirming={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </section>
  )
}
