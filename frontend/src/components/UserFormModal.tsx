import { useEffect, useId, useState, type FormEvent } from 'react'
import { useModalBehavior } from '../utils/modalScrollLock'
import { LabeledButton } from './LabeledButton'
import type { AuthMethod, UserRead } from '../types/users'
import type { UserRole } from '../types/auth'

export interface UserFormValues {
  email_address: string
  display_name: string
  role: UserRole
  auth_method: AuthMethod
  username: string
  password: string
}

interface UserFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  user?: UserRead | null
  saving: boolean
  onSubmit: (values: UserFormValues) => void
  onClose: () => void
}

const EMPTY_VALUES: UserFormValues = {
  email_address: '',
  display_name: '',
  role: 'user',
  auth_method: 'sso',
  username: '',
  password: '',
}

export function UserFormModal({ open, mode, user, saving, onSubmit, onClose }: UserFormModalProps) {
  const titleId = useId()
  const modalRef = useModalBehavior(open, onClose)
  const [values, setValues] = useState<UserFormValues>(EMPTY_VALUES)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && user) {
      setValues({
        email_address: user.email_address,
        display_name: user.display_name ?? '',
        role: user.role,
        auth_method: user.auth_method,
        username: user.username ?? '',
        password: '',
      })
    } else {
      setValues(EMPTY_VALUES)
    }
  }, [open, mode, user])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit(values)
  }

  const isLocal = values.auth_method === 'local'
  const canSubmit =
    values.email_address.trim() !== '' && (mode === 'edit' || !isLocal || (values.username.trim() !== '' && values.password.length >= 8))

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      <div
        className="modal narrow"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <h3 id={titleId}>{mode === 'create' ? 'Crear usuario' : 'Editar usuario'}</h3>

            {mode === 'create' && (
              <div className="form-grid mt-6">
                <div className="field full">
                  <label htmlFor="user-auth-method">Método de acceso</label>
                  <select
                    id="user-auth-method"
                    value={values.auth_method}
                    onChange={(e) => setValues((v) => ({ ...v, auth_method: e.target.value as AuthMethod }))}
                  >
                    <option value="sso">Cuenta de dominio (SSO Microsoft)</option>
                    <option value="local">Cuenta local (usuario y contraseña)</option>
                  </select>
                </div>
              </div>
            )}

            {mode === 'create' && !isLocal && (
              <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>
                Queda pendiente de su primer login: se activa solo cuando esa persona entra por primera vez con SSO
                Microsoft usando este mismo email.
              </p>
            )}
            {mode === 'create' && isLocal && (
              <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>
                La cuenta queda activa de inmediato con la contraseña que fijes acá — comunicásela a la persona por
                fuera del sistema. Va a tener que cambiarla en su primer login.
              </p>
            )}

            <div className="form-grid mt-6">
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

              {mode === 'create' && isLocal && (
                <>
                  <div className="field full">
                    <label htmlFor="user-username">Usuario</label>
                    <input
                      id="user-username"
                      type="text"
                      required
                      minLength={3}
                      placeholder="usuario de acceso (distinto del email)"
                      value={values.username}
                      onChange={(e) => setValues((v) => ({ ...v, username: e.target.value }))}
                    />
                  </div>
                  <div className="field full">
                    <label htmlFor="user-password">Contraseña temporal</label>
                    <input
                      id="user-password"
                      type="text"
                      required
                      minLength={8}
                      placeholder="mínimo 8 caracteres"
                      value={values.password}
                      onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {mode === 'edit' && user?.auth_method === 'local' && (
                <div className="field full">
                  <label htmlFor="user-username-readonly">Usuario</label>
                  <input id="user-username-readonly" type="text" disabled value={user.username ?? ''} />
                </div>
              )}
            </div>
          </div>
          <div className="modal-actions">
            <LabeledButton onClick={onClose}>✕ Cancelar</LabeledButton>
            <LabeledButton
              type="submit"
              variant="primary"
              disabled={!canSubmit}
              loading={saving}
              loadingText="Guardando…"
            >
              {mode === 'create' ? '＋ Crear usuario' : '✓ Guardar cambios'}
            </LabeledButton>
          </div>
        </form>
      </div>
    </div>
  )
}
