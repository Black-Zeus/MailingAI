import { useAuth } from '../context/AuthContext'

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Tu cuenta todavía no fue habilitada. Pídele a un administrador que te dé de alta.',
  oauth_failed: 'No se pudo completar el login con Microsoft. Inténtalo de nuevo.',
}

export function LoginView() {
  const { login } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const errorCode = params.get('login_error')
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? 'No se pudo iniciar sesión.' : null

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
        {errorMessage && <div className="login-error">{errorMessage}</div>}
      </div>
    </div>
  )
}
