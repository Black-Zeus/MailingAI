import { useEffect } from 'react'

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

// Bloquea el scroll de la pagina de fondo mientras un modal esta abierto --
// sin esto, hacer scroll con el mouse sobre un modal (o su backdrop) tambien
// mueve lo que esta detras.
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return
    lockBodyScroll()
    return () => unlockBodyScroll()
  }, [open])
}
