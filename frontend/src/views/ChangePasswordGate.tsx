import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { ApiError, changePassword } from '../api/client'

export function ChangePasswordGate() {
  const { refresh, logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError('La contraseña nueva debe tener al menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmación no coincide con la contraseña nueva.')
      return
    }
    setSaving(true)
    try {
      await changePassword(currentPassword, newPassword)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-icon" style={{ margin: '0 auto 16px' }}>
          M
        </div>
        <strong style={{ fontSize: 18 }}>Cambiá tu contraseña</strong>
        <p>
          Por seguridad, tenés que elegir una contraseña nueva antes de seguir — la que te dio el administrador era
          temporal.
        </p>
        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          <div className="field">
            <label htmlFor="current-password">Contraseña actual (temporal)</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">Contraseña nueva</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirmar contraseña nueva</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <button type="submit" className="btn primary btn-labeled" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Guardando…' : '🔒 Cambiar contraseña'}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
        <button
          type="button"
          className="btn small btn-labeled"
          style={{ width: '100%', marginTop: 10 }}
          onClick={() => logout()}
        >
          ↪ Cancelar y cerrar sesión
        </button>
      </div>
    </div>
  )
}
