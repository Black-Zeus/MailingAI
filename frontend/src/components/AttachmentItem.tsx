import { useEffect, useRef, useState } from 'react'
import { ApiError, downloadAttachmentBlob } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useBodyScrollLock } from '../utils/modalScrollLock'

interface AttachmentItemProps {
  messageId: string
  attachmentId: string
  fileName: string
  extension: string | null
  sizeBytes: number | null
  matchesNamingConvention?: boolean
  matchesSearchPattern?: boolean | null
  contentSha256?: string | null
}

const ICONS: Record<string, string> = {
  pdf: '📄',
  doc: '📝',
  docx: '📝',
  xls: '📊',
  xlsx: '📊',
  ppt: '📽️',
  pptx: '📽️',
  csv: '📈',
  txt: '📃',
}

function iconFor(extension: string | null): string {
  return (extension && ICONS[extension.toLowerCase()]) || '📁'
}

function formatBytes(value: number | null): string {
  if (value === null) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const INLINE_VIEWABLE = new Set(['pdf', 'txt', 'csv'])

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function AttachmentItem({
  messageId,
  attachmentId,
  fileName,
  extension,
  sizeBytes,
  matchesNamingConvention,
  matchesSearchPattern,
  contentSha256,
}: AttachmentItemProps) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  useBodyScrollLock(modalOpen)
  const [hash, setHash] = useState<string | null>(contentSha256 ?? null)
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    }
  }, [])

  async function ensureDownloaded(): Promise<string | null> {
    if (blobUrl) return blobUrl
    setLoading(true)
    try {
      const blob = await downloadAttachmentBlob(messageId, attachmentId)
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      setBlobUrl(url)
      if (!hash) {
        sha256Hex(blob)
          .then(setHash)
          .catch(() => {})
      }
      return url
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo descargar el adjunto.', true)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function copyHash() {
    if (!hash) return
    try {
      await navigator.clipboard.writeText(hash)
      showToast('Hash SHA-256 copiado')
    } catch {
      showToast('No se pudo copiar al portapapeles.', true)
    }
  }

  async function handleClick() {
    const url = await ensureDownloaded()
    if (!url) return
    const ext = (extension || '').toLowerCase()
    if (INLINE_VIEWABLE.has(ext)) {
      setModalOpen(true)
      return
    }
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <>
      <span
        className={`attachment-tag${matchesSearchPattern === false ? ' no-match' : ''}`}
        title={matchesSearchPattern === false ? `${fileName} — no coincide con el patrón de búsqueda usado` : fileName}
      >
        <b>{(extension || 'archivo').toUpperCase()}</b>
        {iconFor(extension)} {fileName}
        {sizeBytes !== null && ` (${formatBytes(sizeBytes)})`}
        {matchesNamingConvention && ' · patrón CR'}
        {matchesSearchPattern === false && ' · no coincide con la búsqueda'}
        <button type="button" onClick={handleClick} disabled={loading}>
          {loading ? 'Descargando…' : blobUrl ? 'Abrir' : 'Descargar'}
        </button>
        {hash && (
          <button
            type="button"
            title={`SHA-256: ${hash}`}
            onClick={copyHash}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}
          >
            🔒 {hash.slice(0, 8)}…
          </button>
        )}
      </span>

      {modalOpen && blobUrl && (
        <div className="modal-backdrop open">
          <div className="modal" style={{ width: 'min(900px, 95vw)' }}>
            <div className="modal-body" style={{ padding: 0 }}>
              <iframe src={blobUrl} title={fileName} style={{ width: '100%', height: '80vh', border: 0 }} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
