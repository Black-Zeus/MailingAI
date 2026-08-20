import { useEffect, useState } from 'react'
import { ApiError, createPendingActionPreset, deletePendingActionPreset, listPendingActionPresets } from '../api/client'
import type { PendingActionPresetRead } from '../types/pendingActionPresets'
import { useToast } from '../context/ToastContext'

// Un solo llamado a esta hook en CasesView (la lista es global, compartida
// entre todos los expedientes) -- se pasa hacia abajo por props a cada
// PendingActionPresetsMenu en vez de que cada fila llame a la hook por su
// cuenta, si no cada expediente abierto simultaneamente (openCaseIds admite
// varios a la vez) dispararia su propio listPendingActionPresets() redundante.
export function usePendingActionPresets() {
  const { showToast } = useToast()
  const [presets, setPresets] = useState<PendingActionPresetRead[]>([])
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    listPendingActionPresets()
      .then(setPresets)
      .catch(() => setPresets([]))
  }, [])

  async function addPreset(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      const preset = await createPendingActionPreset(trimmed)
      setPresets((prev) => [...prev, preset])
      showToast('Frase agregada')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo agregar la frase.', true)
    } finally {
      setAdding(false)
    }
  }

  async function deletePreset(presetId: number) {
    setDeletingId(presetId)
    try {
      await deletePendingActionPreset(presetId)
      setPresets((prev) => prev.filter((p) => p.preset_id !== presetId))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo borrar la frase.', true)
    } finally {
      setDeletingId(null)
    }
  }

  return { presets, adding, deletingId, addPreset, deletePreset }
}

export type PendingActionPresetsState = ReturnType<typeof usePendingActionPresets>
