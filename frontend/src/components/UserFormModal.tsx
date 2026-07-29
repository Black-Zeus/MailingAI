import { useEffect, useState, type FormEvent } from 'react'
import { useBodyScrollLock } from '../utils/modalScrollLock'
import type { UserRead } from '../types/users'
import type { UserRole } from '../types/auth'

export interface UserFormValues {
  email_address: string
  display_name: string
  role: UserRole
}

interface UserFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  user?: UserRead | null
  saving: boolean
  onSubmit: (values: UserFormValues) => void
  onClose: () => void
}

const EMPTY_VALUES: UserFormValues = { email_address: '', display_name: '', role: 'user' }

export function UserFormModal({ open, mode, user, saving, onSubmit, onClose }: UserFormModalProps) {
  useBodyScrollLock(open)
  const [values, setValues] = useState<UserFormValues>(EMPTY_VALUES)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && user) {
      setValues({ email_address: user.email_address, display_name: user.display_name ?? '', role: user.role })
    } else {
      setValues(EMPTY_VALUES)
    }
  }, [open, mode, user])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit(values)
  }

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div className="modal" style={{ width: 'min(480px, 95vw)' }}>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <h3>{mode === 'create' ? 'Crear usuario' : 'Editar usuario'}</h3>
            {mode === 'create' && (
              <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>
                Queda pendiente de su primer login: se activa solo cuando esa persona entra por primera vez con SSO
                Microsoft usando este mismo email.
              </p>
            )}
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field full">
                <label htmlFor="user-email">Email</label>
                <input
                  id="user-email"
                  type="email"
                  required
                  disabled={mode === 'edit'}
                  placeholder="email@empresa.com"
                  value={values.email_address}
                  onChange={(e) => setValues((v) => ({ ...v, email_address: e.target.value }))}
                />
              </div>
              <div className="field full">
                <label htmlFor="user-display-name">Nombre</label>
                <input
                  id="user-display-name"
                  type="text"
                  placeholder="Nombre y apellido (opcional)"
                  value={values.display_name}
                  onChange={(e) => setValues((v) => ({ ...v, display_name: e.target.value }))}
                />
              </div>
              <div className="field full">
                <label htmlFor="user-role">Rol</label>
                <select
                  id="user-role"
                  value={values.role}
                  onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as UserRole }))}
                >
                  <option value="user">Usuario</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-labeled" onClick={onClose}>
              ✕ Cancelar
            </button>
            <button type="submit" className="btn primary btn-labeled" disabled={saving || !values.email_address.trim()}>
              {saving ? 'Guardando…' : mode === 'create' ? '＋ Crear usuario' : '✓ Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
