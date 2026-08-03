import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastState {
  message: string
  error: boolean
  visible: boolean
}

interface ToastContextValue {
  showToast: (message: string, error?: boolean) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ message: '', error: false, visible: false })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error, visible: true })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }))
    }, 2800)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className={`toast${toast.visible ? ' show' : ''}`}
        style={{ borderColor: toast.error ? 'var(--danger)' : 'var(--accent)' }}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast.message}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider')
  return ctx
}
