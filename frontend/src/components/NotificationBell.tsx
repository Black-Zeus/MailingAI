import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import {
  clearAllNotifications,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/client'
import { useToast } from '../context/ToastContext'
import { useModalBehavior } from '../utils/modalScrollLock'
import { ActionButton } from './ActionButton'
import { ConfirmModal } from './ConfirmModal'
import { LabeledButton } from './LabeledButton'
import type { NotificationKind, NotificationRead } from '../types/notifications'

const POLL_MS = 20000

const KIND_LABELS: Record<NotificationKind, string> = {
  case_shared: 'Expediente compartido',
  mailbox_shared: 'Buzón compartido',
  mailbox_delta_sync_done: 'Sincronización de buzón',
  ai_analysis_done: 'Análisis de IA',
}

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

function NotificationDetailModal({
  notification,
  onClose,
}: {
  notification: NotificationRead | null
  onClose: () => void
}) {
  const titleId = useId()
  const open = notification !== null
  const modalRef = useModalBehavior(open, onClose)

  // Portal a document.body: NotificationBell vive dentro de <aside>, que tiene
  // backdrop-filter -- eso crea un containing block nuevo para descendientes
  // position:fixed (mismo efecto que transform/filter), así que sin el portal
  // el backdrop quedaba acotado al tamaño de <aside> en vez de cubrir toda la
  // pantalla como el resto de los modales.
  return createPortal(
    <div className={`modal-backdrop${open ? ' open' : ''}`}>
      {notification && (
        <div className="modal narrow" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="modal-body">
            <h3 id={titleId}>{KIND_LABELS[notification.kind] ?? 'Notificación'}</h3>
            <p style={{ marginTop: 10 }}>{notification.message}</p>
            <p className="text-muted mt-4" style={{ fontSize: 11.5 }}>
              {new Date(notification.created_at).toLocaleString()}
            </p>
          </div>
          <div className="modal-actions">
            <LabeledButton onClick={onClose}>✕ Cerrar</LabeledButton>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

export function NotificationBell() {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [notifications, setNotifications] = useState<NotificationRead[] | null>(null)
  const [detailNotification, setDetailNotification] = useState<NotificationRead | null>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
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

  function handleOpenDetail(n: NotificationRead) {
    setDetailNotification(n)
    handleMarkRead(n)
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

  async function handleClearAll() {
    setClearing(true)
    try {
      await clearAllNotifications()
      setNotifications([])
      setUnread(0)
      setClearModalOpen(false)
    } catch {
      showToast('No se pudieron limpiar las notificaciones.', true)
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
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
              color: 'var(--on-accent-text)',
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
            zIndex: 'var(--z-dropdown)',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
            <strong style={{ fontSize: 12.5 }}>Notificaciones</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {unread > 0 && (
                <button type="button" className="btn small btn-labeled" onClick={handleMarkAllRead}>
                  ✓ Marcar todas leídas
                </button>
              )}
              {notifications !== null && notifications.length > 0 && (
                <ActionButton
                  icon={Trash2}
                  label="Limpiar notificaciones"
                  size="sm"
                  variant="danger"
                  onClick={() => setClearModalOpen(true)}
                />
              )}
            </div>
          </div>
          {notifications === null ? (
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>Cargando…</p>
          ) : notifications.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>Sin notificaciones todavía.</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.notification_id}
                role="button"
                tabIndex={0}
                onClick={() => handleOpenDetail(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleOpenDetail(n)
                  }
                }}
                style={{
                  padding: '8px 6px',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
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
    <NotificationDetailModal notification={detailNotification} onClose={() => setDetailNotification(null)} />
    <ConfirmModal
      open={clearModalOpen}
      title="Limpiar notificaciones"
      description="Se eliminan todas tus notificaciones, leídas y no leídas. Esta acción no se puede deshacer."
      confirmLabel="Limpiar"
      confirmingLabel="Limpiando…"
      confirmIcon="🗑"
      confirming={clearing}
      onCancel={() => setClearModalOpen(false)}
      onConfirm={handleClearAll}
    />
    </>
  )
}
