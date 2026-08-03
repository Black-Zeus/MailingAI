import { Fragment, useEffect, useState } from 'react'
import {
  addCaseMessage,
  ApiError,
  deleteMessages,
  getMessage,
  listCases,
  listMailboxes,
  listMailFolders,
  listMessagesWithTotal,
  retraceMessageAttachments,
} from '../api/client'
import type { MailFolderNode, MessageDetail, MessageListItem } from '../types/messages'
import type { CaseSeedPrefill, CaseSummary } from '../types/cases'
import type { MailboxAccountRead } from '../types/mailboxes'
import { KpiCard } from '../components/KpiCard'
import { ConfirmModal } from '../components/ConfirmModal'
import { AttachmentItem } from '../components/AttachmentItem'
import { MessageBodyModal, type MessageBodyModalState } from '../components/MessageBodyModal'
import { ActionButton } from '../components/ActionButton'
import { Copy, Eye, ExternalLink, FolderPlus, Paperclip, Plus } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { ATTACHMENT_PATTERN_PRESETS } from '../constants/attachmentPatterns'
import { toEndOfDayISO, toStartOfDayISO } from '../utils/dates'

function flattenFolders(nodes: MailFolderNode[], depth = 0): Array<{ node: MailFolderNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenFolders(node.children, depth + 1),
  ])
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CL')
}

type TextSearchMode = 'fulltext' | 'partial'

interface FilterState {
  folder_id: string
  date_from: string
  date_to: string
  from_address: string
  subject_contains: string
  text_search: string
  text_search_mode: TextSearchMode
  has_attachments: 'all' | 'yes' | 'no'
  attachment_pattern: string
  mailbox_account_id: string
}

const EMPTY_FILTERS: FilterState = {
  folder_id: '',
  date_from: '',
  date_to: '',
  from_address: '',
  subject_contains: '',
  text_search: '',
  text_search_mode: 'fulltext',
  has_attachments: 'all',
  attachment_pattern: '',
  mailbox_account_id: '',
}

type ClearScope = 'all' | 'date_range' | 'folder' | 'unlinked'

const PAGE_SIZE = 100

interface MessagesViewProps {
  onCreateCase: (prefill: CaseSeedPrefill) => void
}

export function MessagesView({ onCreateCase }: MessagesViewProps) {
  const { showToast } = useToast()
  const [folders, setFolders] = useState<Array<{ node: MailFolderNode; depth: number }>>([])
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [messages, setMessages] = useState<MessageListItem[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [bodyModal, setBodyModal] = useState<MessageBodyModalState | null>(null)
  const [retracingMessageId, setRetracingMessageId] = useState<string | null>(null)

  const [mailboxes, setMailboxes] = useState<MailboxAccountRead[]>([])

  const [cases, setCases] = useState<CaseSummary[]>([])
  const [targetCaseId, setTargetCaseId] = useState('')
  const [sendingId, setSendingId] = useState<string | null>(null)

  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearScope, setClearScope] = useState<ClearScope>('unlinked')
  const [clearDateFrom, setClearDateFrom] = useState('')
  const [clearDateTo, setClearDateTo] = useState('')
  const [clearFolderId, setClearFolderId] = useState('')
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    listMailFolders()
      .then((tree) => setFolders(flattenFolders(tree)))
      .catch(() => setFolders([]))
    listCases()
      .then(setCases)
      .catch(() => setCases([]))
    listMailboxes()
      .then(setMailboxes)
      .catch(() => setMailboxes([]))
  }, [])

  function buildFilters() {
    return {
      folder_id: filters.folder_id || undefined,
      date_from: filters.date_from ? toStartOfDayISO(filters.date_from) : undefined,
      date_to: filters.date_to ? toEndOfDayISO(filters.date_to) : undefined,
      from_address: filters.from_address || undefined,
      subject_contains: filters.subject_contains || undefined,
      text_search:
        filters.text_search_mode === 'fulltext' ? filters.text_search || undefined : undefined,
      text_contains:
        filters.text_search_mode === 'partial' ? filters.text_search || undefined : undefined,
      has_attachments: filters.has_attachments === 'all' ? undefined : filters.has_attachments === 'yes',
      attachment_pattern: filters.attachment_pattern || undefined,
      mailbox_account_id: filters.mailbox_account_id ? Number(filters.mailbox_account_id) : undefined,
    }
  }

  function toggleAttachmentPatternPreset(fragment: string) {
    setFilters((f) => {
      const pattern = f.attachment_pattern
      const next = pattern.includes(fragment) ? pattern.replace(fragment, '').trim() : `${pattern}${fragment}`
      return { ...f, attachment_pattern: next }
    })
  }

  async function runSearch() {
    setFiltersOpen(false)
    setLoading(true)
    setError(null)
    try {
      const { items, total } = await listMessagesWithTotal({ ...buildFilters(), limit: PAGE_SIZE, offset: 0 })
      setMessages(items)
      setTotal(total)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los mensajes.')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const { items, total } = await listMessagesWithTotal({
        ...buildFilters(),
        limit: PAGE_SIZE,
        offset: messages?.length ?? 0,
      })
      setMessages((prev) => [...(prev ?? []), ...items])
      setTotal(total)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar más mensajes.', true)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleClear() {
    setClearing(true)
    try {
      const result = await deleteMessages({
        scope: clearScope,
        date_from: clearScope === 'date_range' && clearDateFrom ? toStartOfDayISO(clearDateFrom) : undefined,
        date_to: clearScope === 'date_range' && clearDateTo ? toEndOfDayISO(clearDateTo) : undefined,
        folder_id: clearScope === 'folder' ? clearFolderId || undefined : undefined,
      })
      showToast(`${result.deleted} mensaje(s) eliminado(s) del índice`)
      setClearModalOpen(false)
      await runSearch()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo limpiar los mensajes.', true)
    } finally {
      setClearing(false)
    }
  }

  function sendToNewCase(message: MessageListItem) {
    onCreateCase({
      title: message.subject || 'Expediente sin asunto',
      seedType: message.conversation_id ? 'conversation_id' : 'message_id',
      seedValue: message.conversation_id ?? message.message_id,
      caseType: 'custom',
    })
  }

  async function sendToExistingCase(messageId: string) {
    if (!targetCaseId) return
    setSendingId(messageId)
    try {
      await addCaseMessage(Number(targetCaseId), messageId)
      showToast('Mensaje agregado al expediente')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo agregar el mensaje al expediente.', true)
    } finally {
      setSendingId(null)
    }
  }

  async function copyConversationId(conversationId: string) {
    try {
      await navigator.clipboard.writeText(conversationId)
      showToast('ID de conversación copiado')
    } catch {
      showToast('No se pudo copiar al portapapeles.', true)
    }
  }

  async function toggleExpand(messageId: string) {
    if (expandedId === messageId) {
      setExpandedId(null)
      setDetail(null)
      return
    }
    setExpandedId(messageId)
    setDetail(null)
    setDetailError(null)
    try {
      const data = await getMessage(messageId)
      setDetail(data)
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'No se pudo cargar el detalle.')
    }
  }

  function openBodyModal(message: MessageDetail) {
    setBodyModal({
      subject: message.subject || '(sin asunto)',
      bodyContent: message.body_content,
      bodyContentType: message.body_content_type,
      bodyPreview: message.body_preview,
      webLink: message.web_link,
    })
  }

  async function handleRetraceAttachments(messageId: string) {
    setRetracingMessageId(messageId)
    try {
      const result = await retraceMessageAttachments(messageId)
      const data = await getMessage(messageId)
      setDetail(data)
      showToast(
        result.traced_count > 0
          ? `${result.traced_count} adjunto(s) real(es) recuperado(s) desde el buzón`
          : 'Graph no devolvió adjuntos reales para este mensaje.',
        result.traced_count === 0,
      )
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudieron recuperar los adjuntos.', true)
    } finally {
      setRetracingMessageId(null)
    }
  }

  const activeFilterCount = [
    filters.text_search,
    filters.folder_id,
    filters.date_from,
    filters.date_to,
    filters.from_address,
    filters.subject_contains,
    filters.has_attachments !== 'all' ? filters.has_attachments : '',
    filters.attachment_pattern,
    filters.mailbox_account_id,
  ].filter(Boolean).length

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Mensajes indexados</h2>
          <p>
            Busca texto completo (asunto + cuerpo), por carpeta, fecha, remitente o asunto entre los mensajes ya
            traídos desde Microsoft Graph.
          </p>
        </div>
        <button type="button" className="btn danger btn-labeled" onClick={() => setClearModalOpen(true)}>
          🗑 Limpiar mensajes
        </button>
      </div>

      <div className="kpis">
        <KpiCard label="Total real (con estos filtros)" value={total ?? 0} />
        <KpiCard
          label="Con adjuntos (de lo cargado)"
          value={messages?.filter((m) => m.has_attachments).length ?? 0}
          color="var(--accent-2)"
        />
        <KpiCard
          label="Sin adjuntos (de lo cargado)"
          value={messages?.filter((m) => !m.has_attachments).length ?? 0}
          color="var(--muted)"
        />
      </div>
      <div className="panel" style={{ padding: 21, marginBottom: 20 }}>
        <div
          role="button"
          tabIndex={0}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setFiltersOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setFiltersOpen((o) => !o)
            }
          }}
        >
          <strong style={{ fontSize: 14 }}>
            Filtros de búsqueda
            {!filtersOpen && activeFilterCount > 0 && (
              <span style={{ color: 'var(--accent-2)', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                ({activeFilterCount} activo{activeFilterCount === 1 ? '' : 's'})
              </span>
            )}
          </strong>
          <button
            type="button"
            className="btn small btn-labeled"
            onClick={(e) => {
              e.stopPropagation()
              setFiltersOpen((o) => !o)
            }}
          >
            {filtersOpen ? '🔍 Ocultar ▾' : '🔍 Mostrar ▸'}
          </button>
        </div>

        {filtersOpen && (
          <>
        <div className="field full mt-7">
          <label htmlFor="text_search">Buscar texto (asunto + cuerpo)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="text_search"
              type="text"
              placeholder={
                filters.text_search_mode === 'fulltext'
                  ? 'Ej. "plan de despliegue" -borrador'
                  : 'Ej. GFCH-I-069926 (coincidencia exacta de subcadena)'
              }
              value={filters.text_search}
              onChange={(e) => setFilters((f) => ({ ...f, text_search: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              style={{ flex: 1 }}
            />
            <select
              value={filters.text_search_mode}
              onChange={(e) => setFilters((f) => ({ ...f, text_search_mode: e.target.value as TextSearchMode }))}
              style={{ maxWidth: 200 }}
            >
              <option value="fulltext">Texto completo</option>
              <option value="partial">Coincidencia parcial</option>
            </select>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
            {filters.text_search_mode === 'fulltext'
              ? 'Busca por palabras (ignora tildes/mayúsculas, soporta frases entre comillas y exclusión con -).'
              : 'Busca la subcadena exacta, tal cual la escribas — útil para códigos como números de ticket.'}
          </p>
        </div>

        <div className="form-grid mt-7">
          <div className="field">
            <label htmlFor="folder_id">Carpeta</label>
            <select
              id="folder_id"
              value={filters.folder_id}
              onChange={(e) => setFilters((f) => ({ ...f, folder_id: e.target.value }))}
            >
              <option value="">Todas las carpetas</option>
              {folders.map(({ node, depth }) => (
                <option key={node.folder_id} value={node.folder_id}>
                  {'  '.repeat(depth)}
                  {node.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mailbox_account_id">Buzón</label>
            <select
              id="mailbox_account_id"
              value={filters.mailbox_account_id}
              onChange={(e) => setFilters((f) => ({ ...f, mailbox_account_id: e.target.value }))}
            >
              <option value="">Todos los buzones</option>
              {mailboxes
                .filter((m) => m.enabled)
                .map((m) => (
                  <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                    {m.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="has_attachments">Adjuntos</label>
            <select
              id="has_attachments"
              value={filters.has_attachments}
              onChange={(e) => setFilters((f) => ({ ...f, has_attachments: e.target.value as FilterState['has_attachments'] }))}
            >
              <option value="all">Con o sin adjuntos</option>
              <option value="yes">Solo con adjuntos</option>
              <option value="no">Solo sin adjuntos</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="date_from">Desde</label>
            <input
              id="date_from"
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="date_to">Hasta</label>
            <input
              id="date_to"
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="from_address">Remitente contiene</label>
            <input
              id="from_address"
              type="text"
              placeholder="ej. vsoto@tecnocomp.cl"
              value={filters.from_address}
              onChange={(e) => setFilters((f) => ({ ...f, from_address: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="subject_contains">Asunto contiene</label>
            <input
              id="subject_contains"
              type="text"
              placeholder="texto exacto en el asunto"
              value={filters.subject_contains}
              onChange={(e) => setFilters((f) => ({ ...f, subject_contains: e.target.value }))}
            />
          </div>
        </div>

        <div className="field full mt-7">
          <label htmlFor="attachment_pattern">Patrón de adjuntos (regex)</label>
          <input
            id="attachment_pattern"
            type="text"
            placeholder="ej. ^\d{8}.*\.(pdf|docx?|xlsx?)$"
            value={filters.attachment_pattern}
            onChange={(e) => setFilters((f) => ({ ...f, attachment_pattern: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {ATTACHMENT_PATTERN_PRESETS.map((preset) => {
              const active = filters.attachment_pattern.includes(preset.fragment)
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`btn small${active ? ' active' : ''}`}
                  onClick={() => toggleAttachmentPatternPreset(preset.fragment)}
                >
                  {active ? '✓ ' : ''}
                  {preset.label}
                </button>
              )
            })}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
            Solo compara contra adjuntos ya trazados (con nombre real conocido) — no contra mensajes con adjuntos
            sin trazar. Puedes combinar varios presets a la vez.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn primary btn-labeled" onClick={runSearch} disabled={loading}>
            {loading ? 'Buscando…' : '🔍 Buscar'}
          </button>
        </div>
          </>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel table-wrap">
        <table className="table-wide">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" aria-label="Acciones"></th>
              <th scope="col">Buzón</th>
              <th scope="col">Asunto</th>
              <th scope="col">De</th>
              <th scope="col">Enviado</th>
              <th scope="col">Carpeta</th>
              <th scope="col">Adjuntos</th>
            </tr>
          </thead>
          <tbody>
            {messages !== null && messages.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="empty-view">
                  No hay mensajes para estos filtros.
                </td>
              </tr>
            )}
            {messages?.map((message, index) => (
              <Fragment key={message.message_id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(message.message_id)}>
                  <td className="mono text-muted">
                    {index + 1}
                  </td>
                  <td>{expandedId === message.message_id ? '▾' : '▸'}</td>
                  <td>{message.mailbox_label || <span className="text-muted">sin etiquetar</span>}</td>
                  <td>{message.subject || '(sin asunto)'}</td>
                  <td>{message.from_name || message.from_address || '—'}</td>
                  <td>{formatDateTime(message.sent_datetime)}</td>
                  <td>{message.folder_path || '—'}</td>
                  <td>{message.has_attachments ? '📎' : ''}</td>
                </tr>
                {expandedId === message.message_id && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div className="error-detail" style={{ borderTop: '1px solid var(--line)', background: 'transparent' }}>
                        {detailError && <p className="form-error">{detailError}</p>}
                        {!detailError && !detail && <p className="text-muted">Cargando detalle…</p>}
                        {detail && (
                          <dl className="error-grid">
                            <dt>Para</dt>
                            <dd>{detail.to_addresses.join(', ') || '—'}</dd>
                            {detail.cc_addresses.length > 0 && (
                              <>
                                <dt>CC</dt>
                                <dd>{detail.cc_addresses.join(', ')}</dd>
                              </>
                            )}
                            <dt>Ubicación</dt>
                            <dd>{detail.folder_path || 'desconocida'}</dd>
                            <dt>Buzón</dt>
                            <dd>{detail.mailbox_label || 'sin etiquetar (indexado antes del broker de identidad)'}</dd>
                            <dt>ID de conversación</dt>
                            <dd>
                              {detail.conversation_id ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span className="mono">{detail.conversation_id}</span>
                                  <ActionButton icon={Copy} label="Copiar" onClick={() => copyConversationId(detail.conversation_id!)} />
                                </span>
                              ) : (
                                '—'
                              )}
                            </dd>
                            {detail.body_preview && (
                              <>
                                <dt>Vista previa</dt>
                                <dd>{detail.body_preview}</dd>
                              </>
                            )}
                            {detail.has_attachments && detail.attachments.length === 0 && (
                              <>
                                <dt>Adjuntos</dt>
                                <dd>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span className="text-muted">Adjunto no trazado</span>
                                    <ActionButton
                                      icon={Paperclip}
                                      label={retracingMessageId === detail.message_id ? 'Recuperando…' : 'Recuperar adjuntos'}
                                      loading={retracingMessageId === detail.message_id}
                                      onClick={() => handleRetraceAttachments(detail.message_id)}
                                    />
                                  </div>
                                </dd>
                              </>
                            )}
                            {detail.attachments.length > 0 && (
                              <>
                                <dt>Adjuntos</dt>
                                <dd>
                                  <div className="attachment-tags">
                                    {detail.attachments.map((a) => (
                                      <AttachmentItem
                                        key={a.attachment_id}
                                        messageId={detail.message_id}
                                        attachmentId={a.attachment_id}
                                        fileName={a.file_name}
                                        extension={a.extension}
                                        sizeBytes={a.size_bytes}
                                        matchesNamingConvention={a.matches_naming_convention}
                                        matchesSearchPattern={a.matches_search_pattern}
                                        contentSha256={a.content_sha256}
                                      />
                                    ))}
                                  </div>
                                </dd>
                              </>
                            )}
                          </dl>
                        )}
                        {detail && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                            {(detail.body_content || detail.body_preview) && (
                              <ActionButton icon={Eye} label="Ver cuerpo" onClick={() => openBodyModal(detail)} />
                            )}
                            {detail.web_link && (
                              <ActionButton icon={ExternalLink} label="Abrir en Outlook" href={detail.web_link} target="_blank" rel="noreferrer" />
                            )}
                            <ActionButton icon={FolderPlus} label="Enviar a nuevo expediente" onClick={() => sendToNewCase(message)} />
                            <select
                              value={targetCaseId}
                              onChange={(e) => setTargetCaseId(e.target.value)}
                              style={{ maxWidth: 220 }}
                            >
                              <option value="">Elegir expediente existente…</option>
                              {cases.map((c) => (
                                <option key={c.case_id} value={c.case_id}>
                                  {c.title} {c.status === 'closed' ? '(cerrado)' : ''}
                                </option>
                              ))}
                            </select>
                            <ActionButton
                              icon={Plus}
                              label={sendingId === message.message_id ? 'Agregando…' : 'Agregar al expediente'}
                              loading={sendingId === message.message_id}
                              disabled={!targetCaseId}
                              onClick={() => sendToExistingCase(message.message_id)}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {messages && total !== null && messages.length < total && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '16px',
              borderTop: '1px solid var(--line)',
            }}
          >
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              Mostrando {messages.length} de {total} mensajes que coinciden con estos filtros.
            </span>
            <button type="button" className="btn primary btn-labeled" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Cargando…' : `⬇ Cargar ${Math.min(PAGE_SIZE, total - messages.length)} más`}
            </button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={clearModalOpen}
        title="Limpiar mensajes indexados"
        description="Borra mensajes del índice local. No borra nada del buzón real ni de Microsoft Graph — puedes volver a traerlos corriendo un trabajo de nuevo. Si un mensaje borrado estaba correlacionado a un expediente, ese expediente pierde la correlación (el expediente en sí no se borra)."
        confirmLabel="Confirmar limpieza"
        confirming={clearing}
        onCancel={() => setClearModalOpen(false)}
        onConfirm={handleClear}
      >
        <div className="danger-zone">
          <label htmlFor="clearMsgScope">Alcance de la limpieza</label>
          <select
            id="clearMsgScope"
            value={clearScope}
            onChange={(e) => setClearScope(e.target.value as ClearScope)}
          >
            <option value="unlinked">Solo mensajes sin expediente asociado</option>
            <option value="folder">Por carpeta</option>
            <option value="date_range">Por rango de fechas</option>
            <option value="all">Todos los mensajes indexados</option>
          </select>

          {clearScope === 'folder' && (
            <label htmlFor="clearMsgFolder" style={{ marginTop: 10 }}>
              Carpeta
              <select
                id="clearMsgFolder"
                value={clearFolderId}
                onChange={(e) => setClearFolderId(e.target.value)}
              >
                <option value="">Selecciona una carpeta…</option>
                {folders.map(({ node, depth }) => (
                  <option key={node.folder_id} value={node.folder_id}>
                    {'  '.repeat(depth)}
                    {node.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {clearScope === 'date_range' && (
            <div className="field-row mt-4">
              <label htmlFor="clearMsgFrom">
                Desde
                <input
                  id="clearMsgFrom"
                  type="date"
                  value={clearDateFrom}
                  onChange={(e) => setClearDateFrom(e.target.value)}
                />
              </label>
              <label htmlFor="clearMsgTo">
                Hasta
                <input
                  id="clearMsgTo"
                  type="date"
                  value={clearDateTo}
                  onChange={(e) => setClearDateTo(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      </ConfirmModal>

      <MessageBodyModal state={bodyModal} onClose={() => setBodyModal(null)} />
    </section>
  )
}
