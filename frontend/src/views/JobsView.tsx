import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  createCase,
  deleteJob,
  deleteJobs,
  getJobChartImageUrl,
  getJobMessages,
  getMessage,
  cancelJob,
  listJobs,
  listMailboxes,
  listMailFolders,
  retraceMessageAttachments,
  retryJob,
} from '../api/client'
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, type JobParameters, type JobRead } from '../types/jobs'
import type { MailFolderNode, MessageListItem } from '../types/messages'
import type { CaseSeedPrefill } from '../types/cases'
import type { MailboxAccountRead } from '../types/mailboxes'
import { KpiCard } from '../components/KpiCard'
import { ConfirmModal } from '../components/ConfirmModal'
import { AttachmentItem } from '../components/AttachmentItem'
import { FolderTree } from '../components/FolderTree'
import { MessageBodyModal, type MessageBodyModalState } from '../components/MessageBodyModal'
import { ActionButton } from '../components/ActionButton'
import {
  AlertTriangle,
  ClipboardList,
  Eye,
  FolderPlus,
  Info,
  Paperclip,
  Plus,
  RefreshCw,
  Sprout,
  Trash2,
  X,
} from 'lucide-react'
import { useToast } from '../context/ToastContext'

const POLL_INTERVAL_MS = 5000

const ERROR_HELP: Record<string, string> = {
  execute_workflow_error:
    'Hubo un problema de conexión con el buzón (puede ser un permiso vencido o que Microsoft Graph no esté disponible en este momento). Puedes reintentar; si vuelve a fallar, contacta al administrador del sistema.',
}
const DEFAULT_ERROR_HELP =
  'Si el problema persiste después de reintentar, contacta al administrador del sistema para revisar el detalle técnico.'

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CL')
}

function statusClassName(status: JobRead['status']): string {
  return `badge ${status}`
}

function flattenFolders(nodes: MailFolderNode[]): Array<{ node: MailFolderNode }> {
  return nodes.flatMap((node) => [{ node }, ...flattenFolders(node.children)])
}

const PARAM_LABELS: Record<string, string> = {
  date_from: 'Desde',
  date_to: 'Hasta',
  folder: 'Carpeta',
  from_address: 'Remitente contiene',
  subject_contains: 'Asunto contiene',
  conversation_id: 'ID de conversación',
  cr_keyword: 'Palabra clave / código CR',
  chart_type: 'Tipo de gráfico',
  top: 'Resultados por página',
  folder_ids: 'Carpetas seleccionadas',
  pattern: 'Patrón de adjuntos',
  pattern_is_regex: 'Patrón es regex',
  mailbox_account_id: 'Buzón',
}

// case_id y mailbox_account_id ya se muestran de forma clara en el resumen y
// en la columna "Buzón" -- no hace falta repetirlos en la lista cruda de abajo.
const PARAMS_HIDDEN_FROM_LIST = new Set(['case_id', 'mailbox_account_id'])

function buildJobSummary(
  job: JobRead,
  folderPathById: Record<string, string>,
  mailboxLabelById: Record<number, string>,
): string {
  const p = job.parameters
  const mailboxName = (): string => {
    const id = typeof p.mailbox_account_id === 'number' ? p.mailbox_account_id : 1
    return mailboxLabelById[id] || `buzón #${id}`
  }
  const mailboxSuffix = ` · Buzón: ${mailboxName()}`
  const dateRange = (): string => {
    const from = p.date_from ? formatParamValue('date_from', p.date_from, folderPathById, mailboxLabelById) : null
    const to = p.date_to ? formatParamValue('date_to', p.date_to, folderPathById, mailboxLabelById) : null
    if (from && to) return ` entre ${from} y ${to}`
    if (from) return ` desde ${from}`
    if (to) return ` hasta ${to}`
    return ''
  }

  let base: string
  switch (job.job_type) {
    case 'fetch_sent_items':
      base = `Trae los mensajes de Elementos Enviados${dateRange()}.${mailboxSuffix}`
      break
    case 'fetch_message_series': {
      const criteria: string[] = []
      if (p.folder) criteria.push(`carpeta "${folderPathById[String(p.folder)] ?? String(p.folder)}"`)
      if (p.from_address) criteria.push(`remitente contiene "${p.from_address}"`)
      if (p.subject_contains) criteria.push(`asunto/cuerpo contiene "${p.subject_contains}"`)
      base = `Busca mensajes ${criteria.length ? 'con ' + criteria.join(', ') : 'sin filtros de texto'}${dateRange()}.${mailboxSuffix}`
      break
    }
    case 'fetch_related_thread':
      base = `Recupera todos los mensajes de la misma conversación (ID ${String(p.conversation_id ?? '').slice(0, 24)}…).${mailboxSuffix}`
      break
    case 'fetch_cr_attachments':
      base = `Busca adjuntos en Elementos Enviados con la palabra clave "${p.cr_keyword}"${dateRange()}.${mailboxSuffix}`
      break
    case 'generate_activity_charts': {
      const chartLabel = p.chart_type ? CHART_TYPE_LABELS[String(p.chart_type)] ?? String(p.chart_type) : 'línea de tiempo (por defecto)'
      base = `Genera un gráfico de tipo "${chartLabel}"${dateRange() || ' con todo el histórico disponible'}.`
      break
    }
    case 'discover_mail_folders':
      base = `Descubre la estructura de carpetas del buzón.${mailboxSuffix}`
      break
    case 'search_attachments': {
      const folderIds = Array.isArray(p.folder_ids) ? p.folder_ids : []
      const folderNames = folderIds.map((id) => folderPathById[String(id)] ?? String(id))
      const patternText = p.pattern
        ? ` que coincidan con "${p.pattern}"${p.pattern_is_regex ? ' (expresión regular)' : ''}`
        : ' de cualquier nombre'
      base = `Busca adjuntos${patternText} en ${folderNames.length} carpeta(s)${
        folderNames.length ? ': ' + folderNames.join(', ') : ''
      }${dateRange()}.${mailboxSuffix}`
      break
    }
    default:
      base = JOB_TYPE_LABELS[job.job_type] ?? job.job_type
  }

  if (p.case_id) {
    base += ` Vinculado al expediente #${p.case_id} — los resultados se agregan ahí automáticamente al terminar.`
  }
  return base
}

const CHART_TYPE_LABELS: Record<string, string> = {
  timeline: 'Línea de tiempo',
  histogram: 'Histograma',
}

function getUsedParams(parameters: JobParameters): Array<[string, unknown]> {
  return Object.entries(parameters).filter(([key, value]) => {
    if (value === undefined || value === null || value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    if (key === 'pattern_is_regex' && !parameters.pattern) return false
    return true
  })
}

function formatParamValue(
  key: string,
  value: unknown,
  folderPathById: Record<string, string>,
  mailboxLabelById: Record<number, string>,
): string {
  if (key === 'date_from' || key === 'date_to') {
    const raw = String(value)
    // algunos job_types (ej. fetch_cr_attachments corrido manual) guardan
    // yyyyMMdd en vez de ISO -- Date() no lo reconoce como fecha valida, hay
    // que armar el ISO a mano antes de intentar parsearlo.
    if (/^\d{8}$/.test(raw)) {
      const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      const parsed = new Date(iso)
      return isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CL')
    }
    return isNaN(new Date(raw).getTime()) ? raw : formatDateTime(raw)
  }
  if (key === 'chart_type') return CHART_TYPE_LABELS[String(value)] ?? String(value)
  if (key === 'pattern_is_regex') return value ? 'Sí' : 'No'
  if (key === 'folder_ids' && Array.isArray(value)) {
    return value.map((id) => folderPathById[String(id)] ?? `(carpeta desconocida: ${String(id).slice(0, 12)}…)`).join(', ')
  }
  if (key === 'folder') {
    return folderPathById[String(value)] ?? `(carpeta desconocida: ${String(value).slice(0, 12)}…)`
  }
  if (key === 'mailbox_account_id') {
    return mailboxLabelById[Number(value)] ?? `Buzón #${value}`
  }
  return String(value)
}

interface JobsViewProps {
  refreshSignal: number
  onCreateNew: () => void
  onCreateCase: (prefill: CaseSeedPrefill) => void
}

export function JobsView({ refreshSignal, onCreateNew, onCreateCase }: JobsViewProps) {
  const { showToast } = useToast()
  const [jobs, setJobs] = useState<JobRead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [openErrorId, setOpenErrorId] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearScope, setClearScope] = useState<'finished' | 'failed' | 'all-inactive'>('finished')
  const [clearing, setClearing] = useState(false)

  const [openResultsId, setOpenResultsId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, MessageListItem[]>>({})
  const [loadingResultsId, setLoadingResultsId] = useState<string | null>(null)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const [selectedByJob, setSelectedByJob] = useState<Record<string, Set<string>>>({})
  const [creatingBatchId, setCreatingBatchId] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [resultsSubjectFilter, setResultsSubjectFilter] = useState('')
  const [resultsAttachmentFilter, setResultsAttachmentFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [retracingMessageId, setRetracingMessageId] = useState<string | null>(null)
  const [loadingBodyId, setLoadingBodyId] = useState<string | null>(null)
  const [bodyModal, setBodyModal] = useState<MessageBodyModalState | null>(null)

  const [folders, setFolders] = useState<MailFolderNode[] | null>(null)
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [foldersError, setFoldersError] = useState<string | null>(null)
  const [openParamsId, setOpenParamsId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JobRead | null>(null)
  const [deletingJob, setDeletingJob] = useState(false)
  const [mailboxes, setMailboxes] = useState<MailboxAccountRead[]>([])

  const folderPathById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const { node } of flattenFolders(folders ?? [])) {
      map[node.folder_id] = node.folder_path || node.display_name
    }
    return map
  }, [folders])

  const mailboxLabelById = useMemo(() => {
    const map: Record<number, string> = {}
    for (const m of mailboxes) map[m.mailbox_account_id] = m.label
    return map
  }, [mailboxes])

  function mailboxLabelForJob(job: JobRead): string {
    const id = typeof job.parameters.mailbox_account_id === 'number' ? job.parameters.mailbox_account_id : 1
    return mailboxLabelById[id] || `Buzón #${id}`
  }

  useEffect(() => {
    listMailFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
    listMailboxes()
      .then(setMailboxes)
      .catch(() => setMailboxes([]))
  }, [])

  async function load() {
    try {
      const data = await listJobs(200)
      setJobs(data)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los trabajos.')
    }
  }

  const prevStatusesRef = useRef<Record<string, JobRead['status']>>({})

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const data = await listJobs(200)
        if (!cancelled) {
          // Avisa cuando un trabajo pasa de activo a terminado mientras la vista está
          // abierta -- antes el polling actualizaba la lista en silencio, sin ninguna
          // señal de que algo realmente terminó salvo estar mirando la columna de estado.
          // La primera pasada (prevStatus === undefined) nunca dispara un aviso, para no
          // notificar de golpe por todo el historial ya terminado al abrir la vista.
          const prev = prevStatusesRef.current
          for (const job of data) {
            const prevStatus = prev[job.job_id]
            const wasActive = prevStatus === 'queued' || prevStatus === 'running'
            const nowTerminal = job.status === 'success' || job.status === 'failed' || job.status === 'cancelled'
            if (prevStatus !== undefined && wasActive && nowTerminal) {
              showToast(
                job.status === 'success'
                  ? `Trabajo "${JOB_TYPE_LABELS[job.job_type]}" terminó con éxito`
                  : `Trabajo "${JOB_TYPE_LABELS[job.job_type]}" terminó en "${JOB_STATUS_LABELS[job.status]}"`,
                job.status !== 'success',
              )
            }
          }
          prevStatusesRef.current = Object.fromEntries(data.map((j) => [j.job_id, j.status]))
          setJobs(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los trabajos.')
        }
      }
    }
    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  async function handleRetry(jobId: string) {
    setRetryingId(jobId)
    try {
      await retryJob(jobId)
      showToast('Trabajo reintentado')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo reintentar el trabajo.', true)
    } finally {
      setRetryingId(null)
    }
  }

  async function handleCancel(jobId: string) {
    setCancelingId(jobId)
    try {
      await cancelJob(jobId)
      showToast('Trabajo cancelado')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cancelar el trabajo.', true)
    } finally {
      setCancelingId(null)
    }
  }

  async function handleDeleteJob() {
    if (!deleteTarget) return
    setDeletingJob(true)
    try {
      await deleteJob(deleteTarget.job_id)
      showToast('Trabajo eliminado')
      setDeleteTarget(null)
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar el trabajo.', true)
    } finally {
      setDeletingJob(false)
    }
  }

  async function toggleResults(jobId: string, jobType: JobRead['job_type']) {
    if (openResultsId === jobId) {
      setOpenResultsId(null)
      return
    }
    setOpenResultsId(jobId)
    setResultsError(null)
    setResultsSubjectFilter('')
    setResultsAttachmentFilter('all')
    if (jobType === 'discover_mail_folders') {
      if (!folders) {
        setLoadingFolders(true)
        try {
          const data = await listMailFolders()
          setFolders(data)
        } catch (err) {
          setFoldersError(err instanceof ApiError ? err.message : 'No se pudieron cargar las carpetas.')
        } finally {
          setLoadingFolders(false)
        }
      }
      return
    }
    if (jobType === 'generate_activity_charts') {
      return
    }
    if (!results[jobId]) {
      setLoadingResultsId(jobId)
      try {
        const data = await getJobMessages(jobId)
        setResults((prev) => ({ ...prev, [jobId]: data }))
      } catch (err) {
        setResultsError(err instanceof ApiError ? err.message : 'No se pudieron cargar los resultados.')
      } finally {
        setLoadingResultsId(null)
      }
    }
  }

  async function handleRetraceAttachments(jobId: string, messageId: string) {
    setRetracingMessageId(messageId)
    try {
      const result = await retraceMessageAttachments(messageId)
      const data = await getJobMessages(jobId)
      setResults((prev) => ({ ...prev, [jobId]: data }))
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

  function seedCaseFromJob(job: JobRead) {
    if (job.job_type === 'fetch_cr_attachments' && typeof job.parameters.cr_keyword === 'string') {
      onCreateCase({
        title: `Expediente CR: ${job.parameters.cr_keyword}`,
        seedType: 'cr_keyword',
        seedValue: job.parameters.cr_keyword,
        caseType: 'cr',
      })
    } else if (job.job_type === 'fetch_related_thread' && typeof job.parameters.conversation_id === 'string') {
      onCreateCase({
        title: 'Expediente de conversación',
        seedType: 'conversation_id',
        seedValue: job.parameters.conversation_id,
        caseType: 'conversation',
      })
    }
  }

  async function handleViewBody(messageId: string) {
    setLoadingBodyId(messageId)
    try {
      const detail = await getMessage(messageId)
      setBodyModal({
        subject: detail.subject || '(sin asunto)',
        bodyContent: detail.body_content,
        bodyContentType: detail.body_content_type,
        bodyPreview: detail.body_preview,
        webLink: detail.web_link,
      })
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cargar el cuerpo del correo.', true)
    } finally {
      setLoadingBodyId(null)
    }
  }

  function seedCaseFromMessage(message: MessageListItem) {
    onCreateCase({
      title: message.subject || 'Expediente sin asunto',
      seedType: message.conversation_id ? 'conversation_id' : 'message_id',
      seedValue: message.conversation_id ?? message.message_id,
      caseType: 'custom',
    })
  }

  function getFilteredResults(jobId: string): MessageListItem[] {
    const all = results[jobId] ?? []
    return all.filter((m) => {
      if (resultsAttachmentFilter === 'yes' && !m.has_attachments) return false
      if (resultsAttachmentFilter === 'no' && m.has_attachments) return false
      if (resultsSubjectFilter && !(m.subject ?? '').toLowerCase().includes(resultsSubjectFilter.toLowerCase())) {
        return false
      }
      return true
    })
  }

  function toggleSelected(jobId: string, messageId: string) {
    setSelectedByJob((prev) => {
      const current = new Set(prev[jobId] ?? [])
      if (current.has(messageId)) {
        current.delete(messageId)
      } else {
        current.add(messageId)
      }
      return { ...prev, [jobId]: current }
    })
  }

  function toggleSelectAll(jobId: string, messages: MessageListItem[]) {
    setSelectedByJob((prev) => {
      const current = prev[jobId] ?? new Set<string>()
      const allSelected = messages.length > 0 && messages.every((m) => current.has(m.message_id))
      return { ...prev, [jobId]: allSelected ? new Set() : new Set(messages.map((m) => m.message_id)) }
    })
  }

  async function createCasesForSelected(job: JobRead) {
    const selected = selectedByJob[job.job_id]
    if (!selected || selected.size === 0) return
    const messages = (results[job.job_id] ?? []).filter((m) => selected.has(m.message_id))
    setCreatingBatchId(job.job_id)
    setBatchProgress({ done: 0, total: messages.length })
    let successCount = 0
    let failCount = 0
    for (const message of messages) {
      try {
        await createCase(
          message.subject || 'Expediente sin asunto',
          message.conversation_id ? 'conversation_id' : 'message_id',
          message.conversation_id ?? message.message_id,
          'custom',
        )
        successCount += 1
      } catch {
        failCount += 1
      }
      setBatchProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setCreatingBatchId(null)
    setBatchProgress(null)
    setSelectedByJob((prev) => ({ ...prev, [job.job_id]: new Set() }))
    if (failCount === 0) {
      showToast(`${successCount} expediente(s) creado(s)`)
    } else {
      showToast(`${successCount} expediente(s) creado(s), ${failCount} fallaron`, true)
    }
  }

  function hasNaturalCaseSeed(job: JobRead): boolean {
    return (
      (job.job_type === 'fetch_cr_attachments' && typeof job.parameters.cr_keyword === 'string') ||
      (job.job_type === 'fetch_related_thread' && typeof job.parameters.conversation_id === 'string')
    )
  }

  async function handleClear() {
    setClearing(true)
    try {
      const result = await deleteJobs(clearScope)
      showToast(`${result.deleted} trabajo(s) eliminado(s) del historial`)
      setClearModalOpen(false)
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo limpiar el historial.', true)
    } finally {
      setClearing(false)
    }
  }

  const filtered = (jobs ?? []).filter((job) => {
    const matchesStatus = statusFilter === 'all' || job.status === statusFilter
    const haystack = `${job.job_id} ${JOB_TYPE_LABELS[job.job_type] ?? job.job_type}`.toLowerCase()
    return matchesStatus && haystack.includes(search.toLowerCase())
  })

  const totalJobs = jobs?.length ?? 0
  const processedJobs = jobs?.filter((j) => j.status === 'success').length ?? 0
  const errorJobs = jobs?.filter((j) => j.status === 'failed').length ?? 0
  const pendingJobs = jobs?.filter((j) => j.status === 'queued' || j.status === 'running').length ?? 0

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Cola de trabajos</h2>
          <p>Seguimiento de ejecuciones históricas y procesos actualmente en curso.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn danger btn-labeled" onClick={() => setClearModalOpen(true)}>
            🗑 Limpiar historial
          </button>
          <button type="button" className="btn primary btn-labeled" onClick={onCreateNew}>
            ＋ Nuevo trabajo
          </button>
        </div>
      </div>

      <div className="kpis">
        <KpiCard label="Total" value={totalJobs} />
        <KpiCard label="Procesados" value={processedJobs} color="var(--success)" />
        <KpiCard label="Errores" value={errorJobs} color="var(--danger)" />
        <KpiCard label="Pendientes" value={pendingJobs} color="var(--warning)" />
      </div>

      <div className="toolbar">
        <input
          placeholder="Buscar por ID u operación"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Todos los estados</option>
          <option value="running">Ejecutando</option>
          <option value="success">Completados</option>
          <option value="queued">En cola</option>
          <option value="failed">Fallidos</option>
          <option value="cancelled">Cancelados</option>
        </select>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel table-wrap">
        <table className="table-wide">
          <thead>
            <tr>
              <th scope="col">Trabajo</th>
              <th scope="col">Operación</th>
              <th scope="col">Buzón</th>
              <th scope="col">Estado</th>
              <th scope="col">Mensajes</th>
              <th scope="col">Creación</th>
              <th scope="col" aria-label="Acciones"></th>
            </tr>
          </thead>
          <tbody>
            {jobs === null && (
              <tr>
                <td colSpan={7} className="empty-view">
                  Cargando…
                </td>
              </tr>
            )}
            {jobs !== null && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-view">
                  No existen trabajos que coincidan con el filtro.
                </td>
              </tr>
            )}
            {filtered.map((job) => (
              <Fragment key={job.job_id}>
                <tr>
                  <td className="mono">{job.job_id.slice(0, 8)}…</td>
                  <td>{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</td>
                  <td>{mailboxLabelForJob(job)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span className={statusClassName(job.status)}>{JOB_STATUS_LABELS[job.status]}</span>
                      <ActionButton
                        icon={Info}
                        label={openParamsId === job.job_id ? 'Ocultar parámetros' : 'Ver parámetros'}
                        variant={openParamsId === job.job_id ? 'active' : 'default'}
                        onClick={() => setOpenParamsId(openParamsId === job.job_id ? null : job.job_id)}
                      />
                      {(job.status === 'queued' || job.status === 'running') && (
                        <ActionButton
                          icon={X}
                          label={
                            cancelingId === job.job_id
                              ? 'Cancelando…'
                              : 'Cancelar — la búsqueda en curso termina igual, pero el resultado se descarta'
                          }
                          variant="danger"
                          loading={cancelingId === job.job_id}
                          onClick={() => handleCancel(job.job_id)}
                        />
                      )}
                      {job.status === 'failed' && (
                        <ActionButton
                          icon={AlertTriangle}
                          label={openErrorId === job.job_id ? 'Ocultar error' : 'Ver error'}
                          variant="danger"
                          onClick={() => setOpenErrorId(openErrorId === job.job_id ? null : job.job_id)}
                        />
                      )}
                      {job.status === 'failed' && (
                        <ActionButton
                          icon={RefreshCw}
                          label={retryingId === job.job_id ? 'Reintentando…' : 'Reintentar'}
                          loading={retryingId === job.job_id}
                          onClick={() => handleRetry(job.job_id)}
                        />
                      )}
                      {job.status === 'success' && (
                        <ActionButton
                          icon={ClipboardList}
                          label={openResultsId === job.job_id ? 'Ocultar resultados' : 'Ver resultados'}
                          variant={openResultsId === job.job_id ? 'active' : 'default'}
                          onClick={() => toggleResults(job.job_id, job.job_type)}
                        />
                      )}
                      {job.status !== 'queued' && job.status !== 'running' && (
                        <ActionButton icon={Trash2} label="Eliminar" variant="danger" onClick={() => setDeleteTarget(job)} />
                      )}
                    </div>
                    {job.retry_of_job_id && (
                      <div className="retry-detail" title={job.retry_of_job_id}>
                        Reintento de {job.retry_of_job_id.slice(0, 8)}… (#{job.retry_count})
                      </div>
                    )}
                  </td>
                  <td className="mono">{job.result_count !== null ? job.result_count : '—'}</td>
                  <td>{formatDateTime(job.requested_at)}</td>
                  <td></td>
                </tr>
                {openParamsId === job.job_id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <div className="error-detail" style={{ borderTop: '1px solid var(--line)', background: 'transparent' }}>
                        <p style={{ marginBottom: 12 }}>
                          {buildJobSummary(job, folderPathById, mailboxLabelById)}
                        </p>
                        <dl className="error-grid">
                          {getUsedParams(job.parameters)
                            .filter(([key]) => !PARAMS_HIDDEN_FROM_LIST.has(key))
                            .map(([key, value]) => (
                              <Fragment key={key}>
                                <dt>{PARAM_LABELS[key] ?? key}</dt>
                                <dd>{formatParamValue(key, value, folderPathById, mailboxLabelById)}</dd>
                              </Fragment>
                            ))}
                        </dl>
                        {typeof job.parameters.top === 'number' && (
                          <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 10 }}>
                            Microsoft Graph entrega los resultados en páginas de este tamaño. Si hay más
                            resultados que eso, se traen varias páginas automáticamente (hasta 20) — no es un
                            tope duro sobre el total.
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {job.status === 'failed' && openErrorId === job.job_id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <div className="error-detail">
                        <dl className="error-grid">
                          <dt>Código</dt>
                          <dd className="mono">{job.error_code ?? '—'}</dd>
                          <dt>Solicitado</dt>
                          <dd>{formatDateTime(job.requested_at)}</dd>
                          <dt>Finalizado</dt>
                          <dd>{formatDateTime(job.finished_at)}</dd>
                          <dt>Mensaje</dt>
                          <dd>{job.error_message ?? 'Sin detalle registrado.'}</dd>
                        </dl>
                        <div className="error-help">
                          <strong>Sugerencia:</strong>{' '}
                          {(job.error_code && ERROR_HELP[job.error_code]) || DEFAULT_ERROR_HELP}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {job.status === 'success' && openResultsId === job.job_id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <div className="error-detail" style={{ borderTop: '1px solid var(--line)', background: 'transparent' }}>
                        {job.job_type === 'discover_mail_folders' && (
                          <>
                            {foldersError && <p className="form-error">{foldersError}</p>}
                            {loadingFolders && <p className="text-muted">Cargando carpetas…</p>}
                            {folders && <FolderTree nodes={folders} selected={new Set()} onChange={() => {}} readOnly />}
                          </>
                        )}
                        {job.job_type === 'generate_activity_charts' && (
                          <>
                            {job.chart_id === null ? (
                              <p className="text-muted">
                                Este trabajo no tiene un gráfico vinculado (probablemente se ejecutó antes de esta mejora).
                              </p>
                            ) : (
                              <img
                                src={getJobChartImageUrl(job.job_id)}
                                alt="Gráfico generado por este trabajo"
                                style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--line)' }}
                              />
                            )}
                          </>
                        )}
                        {job.job_type !== 'discover_mail_folders' && job.job_type !== 'generate_activity_charts' && (
                          <>
                        {resultsError && <p className="form-error">{resultsError}</p>}
                        {loadingResultsId === job.job_id && (
                          <p className="text-muted">Cargando resultados…</p>
                        )}
                        {results[job.job_id] && results[job.job_id].length === 0 && (
                          <p className="text-muted">
                            Este trabajo no encontró mensajes con esos parámetros.
                          </p>
                        )}
                        {results[job.job_id] && results[job.job_id].length > 0 && (
                          <>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                              <input
                                type="text"
                                placeholder="Asunto contiene..."
                                value={resultsSubjectFilter}
                                onChange={(e) => setResultsSubjectFilter(e.target.value)}
                                style={{ maxWidth: 220 }}
                              />
                              <select
                                value={resultsAttachmentFilter}
                                onChange={(e) => setResultsAttachmentFilter(e.target.value as typeof resultsAttachmentFilter)}
                                style={{ maxWidth: 180 }}
                              >
                                <option value="all">Con o sin adjuntos</option>
                                <option value="yes">Solo con adjuntos</option>
                                <option value="no">Solo sin adjuntos</option>
                              </select>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                                {getFilteredResults(job.job_id).length} de {results[job.job_id].length} mensaje(s)
                                {(selectedByJob[job.job_id]?.size ?? 0) > 0 &&
                                  ` · ${selectedByJob[job.job_id]!.size} seleccionado(s)`}
                              </span>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {hasNaturalCaseSeed(job) && (
                                  <ActionButton
                                    icon={FolderPlus}
                                    label="Crear expediente con estos resultados"
                                    onClick={() => seedCaseFromJob(job)}
                                  />
                                )}
                                <ActionButton
                                  icon={Plus}
                                  label={
                                    creatingBatchId === job.job_id
                                      ? `Creando ${batchProgress?.done ?? 0}/${batchProgress?.total ?? 0}…`
                                      : `Crear expedientes separados (${selectedByJob[job.job_id]?.size ?? 0})`
                                  }
                                  variant="primary"
                                  loading={creatingBatchId === job.job_id}
                                  disabled={(selectedByJob[job.job_id]?.size ?? 0) === 0}
                                  onClick={() => createCasesForSelected(job)}
                                />
                              </div>
                            </div>
                            {getFilteredResults(job.job_id).length === 0 &&
                              ((results[job.job_id]?.length ?? 0) === 0 && job.result_count ? (
                                <p className="text-muted">
                                  Este trabajo indexó {job.result_count} mensaje(s) en su momento, pero ya no
                                  aparecen aquí — probablemente un trabajo más reciente con fechas solapadas los
                                  volvió a traer, y quedaron asociados a ese trabajo en vez de a este. Los mensajes
                                  siguen indexados igual, solo cambió a qué trabajo se atribuyen.
                                </p>
                              ) : (
                                <p className="text-muted">Ningún mensaje coincide con el filtro.</p>
                              ))}
                            {getFilteredResults(job.job_id).length > 0 && (
                            <table className="table-wide">
                              <thead>
                                <tr>
                                  <th scope="col" style={{ width: 28 }}>
                                    <input
                                      type="checkbox"
                                      aria-label="Seleccionar todos los mensajes"
                                      checked={
                                        getFilteredResults(job.job_id).length > 0 &&
                                        getFilteredResults(job.job_id).every((m) => selectedByJob[job.job_id]?.has(m.message_id))
                                      }
                                      onChange={() => toggleSelectAll(job.job_id, getFilteredResults(job.job_id))}
                                    />
                                  </th>
                                  <th scope="col">Asunto</th>
                                  <th scope="col">De</th>
                                  <th scope="col">Enviado</th>
                                  <th scope="col">Carpeta</th>
                                  <th scope="col">Adjuntos</th>
                                  <th scope="col" aria-label="Acciones"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {getFilteredResults(job.job_id).map((m) => (
                                  <tr key={m.message_id}>
                                    <td>
                                      <input
                                        type="checkbox"
                                        aria-label={`Seleccionar mensaje: ${m.subject || '(sin asunto)'}`}
                                        checked={selectedByJob[job.job_id]?.has(m.message_id) ?? false}
                                        onChange={() => toggleSelected(job.job_id, m.message_id)}
                                      />
                                    </td>
                                    <td>{m.subject || '(sin asunto)'}</td>
                                    <td>{m.from_name || m.from_address || '—'}</td>
                                    <td>{formatDateTime(m.sent_datetime)}</td>
                                    <td>{m.folder_path || '—'}</td>
                                    <td>
                                      {!m.has_attachments && <span className="text-muted">Sin adjunto</span>}
                                      {m.has_attachments && m.attachments.length === 0 && (
                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                          <span className="text-muted">Adjunto no trazado</span>
                                          <ActionButton
                                            icon={Paperclip}
                                            label={retracingMessageId === m.message_id ? 'Recuperando…' : 'Recuperar adjuntos'}
                                            loading={retracingMessageId === m.message_id}
                                            onClick={() => handleRetraceAttachments(job.job_id, m.message_id)}
                                          />
                                        </div>
                                      )}
                                      {m.attachments.length > 0 && (
                                        <div className="attachment-tags">
                                          {m.attachments.map((a) => (
                                            <AttachmentItem
                                              key={a.attachment_id}
                                              messageId={m.message_id}
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
                                      )}
                                    </td>
                                    <td>
                                      <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                                        <ActionButton
                                          icon={Eye}
                                          label="Ver cuerpo"
                                          loading={loadingBodyId === m.message_id}
                                          onClick={() => handleViewBody(m.message_id)}
                                        />
                                        <ActionButton icon={Sprout} label="Usar como semilla" onClick={() => seedCaseFromMessage(m)} />
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            )}
                          </>
                        )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={clearModalOpen}
        title="Limpiar historial de trabajos"
        description="Esta acción elimina los registros de trabajos finalizados. Los trabajos activos (en cola o ejecutando) y todos los mensajes/carpetas/expedientes ya indexados permanecen intactos."
        confirmLabel="Confirmar limpieza"
        confirming={clearing}
        onCancel={() => setClearModalOpen(false)}
        onConfirm={handleClear}
      >
        <div className="danger-zone">
          <label htmlFor="clearScope">Alcance de la limpieza</label>
          <select
            id="clearScope"
            value={clearScope}
            onChange={(e) => setClearScope(e.target.value as typeof clearScope)}
          >
            <option value="finished">Trabajos completados y fallidos</option>
            <option value="failed">Solo trabajos fallidos</option>
            <option value="all-inactive">Todo el historial inactivo (incluye cancelados)</option>
          </select>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Eliminar trabajo"
        description={
          deleteTarget
            ? `Esta acción elimina el registro del trabajo "${JOB_TYPE_LABELS[deleteTarget.job_type] ?? deleteTarget.job_type}" (${deleteTarget.job_id.slice(0, 8)}…) del historial. No afecta los mensajes/carpetas/expedientes que ya haya generado.`
            : ''
        }
        confirmLabel="Eliminar trabajo"
        confirming={deletingJob}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteJob}
      />

      <MessageBodyModal state={bodyModal} onClose={() => setBodyModal(null)} />
    </section>
  )
}
