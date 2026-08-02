import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../api/client'

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Tu cuenta todavía no fue habilitada. Pídele a un administrador que te dé de alta.',
  oauth_failed: 'No se pudo completar el login con Microsoft. Inténtalo de nuevo.',
}

export function LoginView() {
  const { login, loginLocal } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const errorCode = params.get('login_error')
  const ssoErrorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? 'No se pudo iniciar sesión.' : null

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  async function handleLocalLogin(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    setLoggingIn(true)
    try {
      await loginLocal(username, password)
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.')
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-icon" style={{ margin: '0 auto 16px' }}>
          M
        </div>
        <strong style={{ fontSize: 18 }}>MailingAI</strong>
        <p>Inicia sesión con tu cuenta corporativa de Microsoft para continuar.</p>
        <button type="button" className="btn primary btn-labeled" onClick={login}>
          🔑 Ingresar con Microsoft
        </button>
        {ssoErrorMessage && <div className="login-error">{ssoErrorMessage}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>o con una cuenta local</span>
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>

        <form onSubmit={handleLocalLogin} style={{ textAlign: 'left' }}>
          <div className="field">
            <label htmlFor="local-username">Usuario</label>
            <input
              id="local-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="local-password">Contraseña</label>
            <input
              id="local-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-labeled" style={{ width: '100%' }} disabled={loggingIn}>
            {loggingIn ? 'Ingresando…' : '👤 Ingresar'}
          </button>
          {localError && <div className="login-error">{localError}</div>}
        </form>
      </div>
    </div>
  )
}
