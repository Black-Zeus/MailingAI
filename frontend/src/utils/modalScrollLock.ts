import { useEffect, useRef } from 'react'

// Varios modales pueden montarse a la vez (aunque normalmente solo uno este
// realmente abierto) -- se cuenta cuantos estan "abiertos" en vez de pisar
// directamente document.body.style.overflow, para que cerrar uno no
// desbloquee el scroll si otro sigue abierto.
let lockCount = 0

function lockBodyScroll() {
  lockCount += 1
  if (lockCount === 1) {
    document.body.style.overflow = 'hidden'
  }
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = ''
  }
}

/**
 * Comportamiento compartido de todos los modales de la app: bloquea el
 * scroll de fondo, cierra con Escape, mueve el foco al modal al abrirse y lo
 * devuelve a quien lo abrió al cerrarse -- sin esto ultimo, un usuario de
 * teclado/lector de pantalla no recibe ninguna señal de que se abrio un
 * dialogo y puede tabular hacia contenido detras del backdrop.
 *
 * No implementa un focus trap completo (Tab/Shift+Tab no quedan atrapados
 * dentro del modal todavia) -- es una mejora deliberadamente pendiente, no
 * un descuido.
 *
 * Devuelve un ref: hay que pasarlo al contenedor `.modal` (con
 * `tabIndex={-1}` para que sea focuseable a mano sin entrar al orden de tab
 * normal).
 */
export function useModalBehavior(open: boolean, onClose?: () => void) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lockBodyScroll()
    previouslyFocused.current = document.activeElement as HTMLElement | null
    modalRef.current?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      unlockBodyScroll()
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  return modalRef
}
