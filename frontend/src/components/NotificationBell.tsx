import { useEffect, useRef, useState } from 'react'
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/client'
import type { NotificationRead } from '../types/notifications'

const POLL_MS = 20000

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} d`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [notifications, setNotifications] = useState<NotificationRead[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    function loadCount() {
      getUnreadNotificationCount()
        .then((r) => {
          if (!cancelled) setUnread(r.unread)
        })
        .catch(() => {
          if (!cancelled) setUnread(0)
        })
    }
    loadCount()
    const interval = setInterval(loadCount, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      listNotifications()
        .then(setNotifications)
        .catch(() => setNotifications([]))
    }
  }

  async function handleMarkRead(n: NotificationRead) {
    if (n.read_at) return
    try {
      await markNotificationRead(n.notification_id)
      setNotifications((prev) => prev?.map((x) => (x.notification_id === n.notification_id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null)
      setUnread((u) => Math.max(0, u - 1))
    } catch {
      // silencioso: no es una accion critica
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null)
      setUnread(0)
    } catch {
      // silencioso
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn small btn-labeled"
        style={{ width: '100%', position: 'relative' }}
        onClick={toggleOpen}
      >
        🔔 Notificaciones
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              background: 'var(--danger)',
              color: '#fff',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="system-card"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 8,
            width: 300,
            maxHeight: 360,
            overflowY: 'auto',
            zIndex: 40,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 12.5 }}>Notificaciones</strong>
            {unread > 0 && (
              <button type="button" className="btn small btn-labeled" onClick={handleMarkAllRead}>
                ✓ Marcar todas leídas
              </button>
            )}
          </div>
          {notifications === null ? (
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>Cargando…</p>
          ) : notifications.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>Sin notificaciones todavía.</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.notification_id}
                onClick={() => handleMarkRead(n)}
                style={{
                  padding: '8px 6px',
                  borderBottom: '1px solid var(--line)',
                  cursor: n.read_at ? 'default' : 'pointer',
                  opacity: n.read_at ? 0.55 : 1,
                }}
              >
                <div style={{ fontSize: 12.5 }}>{n.message}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{timeAgo(n.created_at)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
