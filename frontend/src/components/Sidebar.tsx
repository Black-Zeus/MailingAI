import { useEffect, useState } from 'react'
import { getSystemStatus } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { NotificationBell } from './NotificationBell'
import type { SystemStatus } from '../types/system'

export type ViewName = 'new' | 'jobs' | 'cases' | 'dashboard' | 'messages' | 'attachments' | 'settings'

const NAV_ITEMS: Array<{ view: ViewName; icon: string; label: string }> = [
  { view: 'dashboard', icon: '📊', label: 'Dashboard' },
  { view: 'new', icon: '＋', label: 'Nueva consulta' },
  { view: 'jobs', icon: '◷', label: 'Trabajos' },
  { view: 'cases', icon: '▤', label: 'Expedientes' },
  { view: 'messages', icon: '✉', label: 'Mensajes' },
  { view: 'attachments', icon: '📎', label: 'Adjuntos' },
  { view: 'settings', icon: '⚙', label: 'Configuración' },
]

const STATUS_POLL_MS = 15000

interface SidebarProps {
  activeView: ViewName
  onNavigate: (view: ViewName) => void
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [status, setStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      try {
        const data = await getSystemStatus()
        if (!cancelled) setStatus(data)
      } catch {
        if (!cancelled) setStatus(null)
      }
    }
    load()
    const interval = setInterval(load, STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isAdmin])

  return (
    <aside>
      <div className="brand">
        <div className="brand-icon">M</div>
        <div>
          <strong>MailingAI</strong>
          <small>Análisis de buzón</small>
        </div>
      </div>
      <nav>
        {NAV_ITEMS.filter((item) => item.view !== 'settings' || isAdmin).map((item) => (
          <button
            key={item.view}
            type="button"
            className={`nav-btn${activeView === item.view ? ' active' : ''}`}
            onClick={() => onNavigate(item.view)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      {isAdmin && (
        <div className="system-card">
          <div className="status-row">
            <span>
              <i className={`dot${status && !status.backend ? ' off' : ''}`}></i>FastAPI
            </span>
            <strong>{status?.backend ? 'Activo' : status === null ? '…' : 'Inactivo'}</strong>
          </div>
          <div className="status-row">
            <span>
              <i className={`dot${status && !status.postgres ? ' off' : ''}`}></i>PostgreSQL
            </span>
            <strong>{status?.postgres ? 'Activo' : status === null ? '…' : 'Inactivo'}</strong>
          </div>
          <div className="status-row">
            <span>
              <i className={`dot${status && !status.n8n ? ' off' : ''}`}></i>n8n
            </span>
            <strong>{status?.n8n ? 'Activo' : status === null ? '…' : 'Inactivo'}</strong>
          </div>
          <div className="status-row">
            <span>
              <i className={`dot${status && !status.ai ? ' off' : ''}`}></i>IA
            </span>
            <strong>{status?.ai ? 'Activo' : status === null ? '…' : 'Inactivo'}</strong>
          </div>
        </div>
      )}
      <div className="system-card" style={{ marginTop: isAdmin ? 10 : 'auto' }}>
        <div className="status-row">
          <span title={user?.email_address}>{user?.display_name || user?.email_address}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <NotificationBell />
        </div>
        <button
          type="button"
          className="btn small btn-labeled"
          style={{ width: '100%', marginTop: 8 }}
          onClick={logout}
        >
          ↪ Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
