import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, createJob, getStats, listMailboxes, listMailFolders } from '../api/client'
import { JOB_TYPE_LABELS, type JobParameters, type JobType } from '../types/jobs'
import type { StatsResponse } from '../types/system'
import type { MailFolderNode } from '../types/messages'
import type { MailboxAccountRead } from '../types/mailboxes'
import { FolderTree } from '../components/FolderTree'
import { useToast } from '../context/ToastContext'
import { ATTACHMENT_PATTERN_PRESETS as PATTERN_PRESETS } from '../constants/attachmentPatterns'
import { toEndOfDayISO, toStartOfDayISO } from '../utils/dates'

const JOB_TYPES = Object.keys(JOB_TYPE_LABELS) as JobType[]
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FieldsShown {
  dateRange: boolean
  folder: boolean
  fromAddress: boolean
  subjectContains: boolean
  conversationId: boolean
  crKeyword: boolean
  chartType: boolean
  top: boolean
  folderTree: boolean
  pattern: boolean
  mailbox: boolean
}

const FIELDS_BY_JOB_TYPE: Record<JobType, FieldsShown> = {
  fetch_sent_items: {
    dateRange: true,
    folder: false,
    fromAddress: false,
    subjectContains: false,
    conversationId: false,
    crKeyword: false,
    chartType: false,
    top: true,
    folderTree: false,
    pattern: false,
    mailbox: true,
  },
  fetch_message_series: {
    dateRange: true,
    folder: false,
    fromAddress: true,
    subjectContains: true,
    conversationId: false,
    crKeyword: false,
    chartType: false,
    top: true,
    folderTree: true,
    pattern: false,
    mailbox: true,
  },
  fetch_related_thread: {
    dateRange: false,
    folder: false,
    fromAddress: false,
    subjectContains: false,
    conversationId: true,
    crKeyword: false,
    chartType: false,
    top: true,
    folderTree: false,
    pattern: false,
    mailbox: true,
  },
  fetch_cr_attachments: {
    dateRange: true,
    folder: false,
    fromAddress: false,
    subjectContains: false,
    conversationId: false,
    crKeyword: true,
    chartType: false,
    top: true,
    folderTree: false,
    pattern: false,
    mailbox: true,
  },
  generate_activity_charts: {
    dateRange: true,
    folder: false,
    fromAddress: false,
    subjectContains: false,
    conversationId: false,
    crKeyword: false,
    chartType: true,
    top: false,
    folderTree: false,
    pattern: false,
    mailbox: true,
  },
  discover_mail_folders: {
    dateRange: false,
    folder: false,
    fromAddress: false,
    subjectContains: false,
    conversationId: false,
    crKeyword: false,
    chartType: false,
    top: false,
    folderTree: false,
    pattern: false,
    mailbox: true,
  },
  search_attachments: {
    dateRange: true,
    folder: false,
    fromAddress: false,
    subjectContains: false,
    conversationId: false,
    crKeyword: false,
    chartType: false,
    top: true,
    folderTree: true,
    pattern: true,
    mailbox: true,
  },
}

const EMPTY_FORM = {
  dateFrom: '',
  dateTo: '',
  folder: '',
  fromAddress: '',
  subjectContains: '',
  conversationId: '',
  crKeyword: 'CR',
  chartType: 'timeline' as 'timeline' | 'histogram',
  top: 50,
}

interface NewJobViewProps {
  onJobCreated: () => void
}

export function NewJobView({ onJobCreated }: NewJobViewProps) {
  const { showToast } = useToast()
  const [jobType, setJobType] = useState<JobType>('fetch_sent_items')
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [folders, setFolders] = useState<MailFolderNode[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [pattern, setPattern] = useState('')
  const [patternIsRegex, setPatternIsRegex] = useState(false)
  const [mailboxes, setMailboxes] = useState<MailboxAccountRead[]>([])
  const [mailboxAccountId, setMailboxAccountId] = useState<number | null>(null)

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => setStats(null))
    listMailFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
    listMailboxes()
      .then((data) => {
        setMailboxes(data)
        const firstEnabled = data.find((m) => m.enabled)
        if (firstEnabled) setMailboxAccountId(firstEnabled.mailbox_account_id)
      })
      .catch(() => setMailboxes([]))
  }, [])

  const fields = FIELDS_BY_JOB_TYPE[jobType]

  function togglePreset(fragment: string) {
    if (pattern.includes(fragment)) {
      setPattern(pattern.replace(fragment, '').trim())
    } else {
      setPattern(pattern ? `${pattern}${fragment}` : fragment)
      setPatternIsRegex(true)
    }
  }

  function validate(): string | null {
    if (fields.mailbox && !mailboxAccountId) {
      return 'Selecciona un buzón antes de continuar — todo trabajo debe quedar asociado a una cuenta concreta.'
    }
    if (fields.dateRange && form.dateFrom && form.dateTo && form.dateFrom > form.dateTo) {
      return 'La fecha inicial no puede ser posterior a la fecha final.'
    }
    if (fields.fromAddress && form.fromAddress && !EMAIL_PATTERN.test(form.fromAddress)) {
      return 'El remitente no tiene formato de correo válido.'
    }
    if (fields.conversationId && !form.conversationId.trim()) {
      return 'Este tipo de operación necesita un conversation_id.'
    }
    if (fields.top && (form.top < 1 || form.top > 500)) {
      return 'El límite de mensajes debe estar entre 1 y 500.'
    }
    if (fields.folderTree && selectedFolderIds.size === 0) {
      return 'Selecciona al menos una carpeta en el árbol.'
    }
    if (jobType === 'fetch_message_series' && selectedFolderIds.size > 5) {
      return `Elegiste ${selectedFolderIds.size} carpetas — esto crea un trabajo por carpeta, todos en paralelo contra Microsoft Graph. Para no saturarlo (y que terminen atascados por throttling), elige como máximo 5 a la vez. Ojo: marcar una carpeta padre (ej. "Clientes") selecciona automáticamente todas sus subcarpetas.`
    }
    if (fields.pattern && patternIsRegex && pattern) {
      try {
        new RegExp(pattern)
      } catch {
        return 'El patrón no es una expresión regular válida.'
      }
    }
    return null
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const parameters: JobParameters = {}
    if (fields.mailbox && mailboxAccountId) parameters.mailbox_account_id = mailboxAccountId
    if (fields.top) parameters.top = form.top
    if (fields.dateRange) {
      // El input solo permite elegir dia (sin hora) -- se expande al rango
      // completo del dia (00:00:00 a 23:59:59) para no perder los mensajes
      // del ultimo dia seleccionado.
      if (form.dateFrom) parameters.date_from = toStartOfDayISO(form.dateFrom)
      if (form.dateTo) parameters.date_to = toEndOfDayISO(form.dateTo)
    }
    if (fields.folder && form.folder) parameters.folder = form.folder.trim()
    if (fields.fromAddress && form.fromAddress) parameters.from_address = form.fromAddress.trim()
    if (fields.subjectContains && form.subjectContains) {
      parameters.subject_contains = form.subjectContains.trim()
    }
    if (fields.conversationId) parameters.conversation_id = form.conversationId.trim()
    if (fields.crKeyword) parameters.cr_keyword = form.crKeyword.trim() || 'CR'
    if (fields.chartType) parameters.chart_type = form.chartType
    // search_attachments busca varias carpetas DENTRO de un mismo job (le
    // manda folder_ids). fetch_message_series solo entiende una carpeta por
    // job (folder) -- si eligen varias en el arbol, se crea un job por
    // carpeta en vez de mandarle un array que no sabe interpretar.
    if (fields.folderTree && jobType !== 'fetch_message_series') {
      parameters.folder_ids = Array.from(selectedFolderIds)
    }
    if (fields.pattern) {
      if (pattern.trim()) parameters.pattern = pattern.trim()
      parameters.pattern_is_regex = patternIsRegex
    }

    setSubmitting(true)
    setError(null)
    try {
      if (jobType === 'fetch_message_series' && fields.folderTree) {
        const folderIds = Array.from(selectedFolderIds)
        const created = await Promise.all(
          folderIds.map((folder) => createJob(jobType, { ...parameters, folder })),
        )
        showToast(
          created.length === 1
            ? `Trabajo ${created[0].job_id.slice(0, 8)}… agregado a la cola`
            : `${created.length} trabajos agregados a la cola (uno por carpeta elegida)`,
        )
      } else {
        const result = await createJob(jobType, parameters)
        showToast(`Trabajo ${result.job_id.slice(0, 8)}… agregado a la cola`)
      }
      setForm(EMPTY_FORM)
      setSelectedFolderIds(new Set())
      setPattern('')
      setPatternIsRegex(false)
      onJobCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el trabajo.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Crear trabajo de análisis</h2>
          <p>
            Define el alcance de la búsqueda. El trabajo se ejecuta en segundo plano contra tu buzón real vía
            Microsoft Graph, y conserva trazabilidad de mensajes, carpetas y adjuntos.
          </p>
        </div>
      </div>
      <div className="grid">
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h3>Parámetros del trabajo</h3>
            <span>Microsoft Graph · Solo lectura</span>
          </div>
          <div className="panel-body form-grid">
            <div className="field full">
              <label htmlFor="operation">Tipo de operación</label>
              <select id="operation" value={jobType} onChange={(e) => setJobType(e.target.value as JobType)}>
                {JOB_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {JOB_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            {fields.mailbox && (
              <div className="field full">
                <label htmlFor="mailbox">Buzón</label>
                <select
                  id="mailbox"
                  value={mailboxAccountId ?? ''}
                  onChange={(e) => setMailboxAccountId(Number(e.target.value))}
                >
                  {mailboxes.filter((m) => m.enabled).length === 0 && (
                    <option value="">No hay buzones habilitados</option>
                  )}
                  {mailboxes
                    .filter((m) => m.enabled)
                    .map((m) => (
                      <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                        {m.label} ({m.email_address || 'sin correo'})
                      </option>
                    ))}
                </select>
                {mailboxes.length === 0 && (
                  <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                    No hay ningún buzón conectado todavía — anda a Configuración → Buzones para conectar uno.
                  </p>
                )}
              </div>
            )}

            {fields.dateRange && (
              <>
                <div className="field">
                  <label htmlFor="dateFrom">Fecha inicial</label>
                  <input
                    id="dateFrom"
                    type="date"
                    value={form.dateFrom}
                    onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="dateTo">Fecha final</label>
                  <input
                    id="dateTo"
                    type="date"
                    value={form.dateTo}
                    onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
                  />
                </div>
              </>
            )}

            {fields.folder && (
              <div className="field">
                <label htmlFor="folder">Carpeta</label>
                <input
                  id="folder"
                  type="text"
                  placeholder="SentItems (vacío = todas)"
                  value={form.folder}
                  onChange={(e) => setForm({ ...form, folder: e.target.value })}
                />
              </div>
            )}

            {fields.fromAddress && (
              <div className="field">
                <label htmlFor="fromAddress">Remitente</label>
                <input
                  id="fromAddress"
                  type="email"
                  placeholder="alguien@dominio.com"
                  value={form.fromAddress}
                  onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}
                />
              </div>
            )}

            {fields.subjectContains && (
              <div className="field full">
                <label htmlFor="subjectContains">Buscar en asunto y cuerpo</label>
                <input
                  id="subjectContains"
                  type="text"
                  placeholder="ej. TCK-2026-000123  o  Proyecto -Newsletter"
                  value={form.subjectContains}
                  onChange={(e) => setForm({ ...form, subjectContains: e.target.value })}
                />
                <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                  Términos separados por espacio, coincidencia parcial (se pueden escribir como <code>%texto%</code>{' '}
                  o directo). Agrega <code>-</code> antes de un término para excluir los correos que lo contengan —
                  ej. <code>Proyecto -Newsletter</code>. Busca en el asunto y en el cuerpo completo del correo,
                  igual que la coincidencia parcial ya disponible en "Mensajes".
                </p>
              </div>
            )}

            {fields.conversationId && (
              <div className="field full">
                <label htmlFor="conversationId">ID de conversación</label>
                <input
                  id="conversationId"
                  type="text"
                  required
                  value={form.conversationId}
                  onChange={(e) => setForm({ ...form, conversationId: e.target.value })}
                />
              </div>
            )}

            {fields.crKeyword && (
              <div className="field">
                <label htmlFor="crKeyword">Palabra clave / código de proyecto</label>
                <input
                  id="crKeyword"
                  type="text"
                  value={form.crKeyword}
                  onChange={(e) => setForm({ ...form, crKeyword: e.target.value })}
                />
              </div>
            )}

            {fields.chartType && (
              <div className="field">
                <label htmlFor="chartType">Tipo de gráfico</label>
                <select
                  id="chartType"
                  value={form.chartType}
                  onChange={(e) => setForm({ ...form, chartType: e.target.value as 'timeline' | 'histogram' })}
                >
                  <option value="timeline">Línea de tiempo</option>
                  <option value="histogram">Histograma</option>
                </select>
              </div>
            )}

            {fields.top && (
              <div className="field">
                <label htmlFor="top">Límite de mensajes por carpeta</label>
                <input
                  id="top"
                  type="number"
                  min={1}
                  max={500}
                  value={form.top}
                  onChange={(e) => setForm({ ...form, top: Number(e.target.value) })}
                />
              </div>
            )}

            {(fields.folderTree || fields.pattern) && (
              <div className="field full search-scope-grid">
                {fields.folderTree && (
                  <div className="field">
                    <label>Carpetas ({selectedFolderIds.size} seleccionada(s))</label>
                    <FolderTree nodes={folders} selected={selectedFolderIds} onChange={setSelectedFolderIds} />
                    {jobType === 'fetch_message_series' && (
                      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                        Elige cualquier carpeta o subcarpeta (ej. Clientes/Acme). Si eliges varias, se crea un
                        trabajo por carpeta. Deja "Buscar en asunto y cuerpo" vacío para traer todos los correos de
                        la carpeta, sin filtrar por texto.
                      </p>
                    )}
                  </div>
                )}

                {fields.pattern && (
                  <div className="field">
                    <label htmlFor="pattern">Patrón del nombre de archivo (opcional)</label>
                    <input
                      id="pattern"
                      type="text"
                      placeholder="Vacío = todos los adjuntos, sin importar el formato"
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={patternIsRegex}
                        onChange={(e) => setPatternIsRegex(e.target.checked)}
                      />
                      Es expresión regular (si no, se busca como texto libre dentro del nombre)
                    </label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {PATTERN_PRESETS.map((preset) => {
                        const active = patternIsRegex && pattern.includes(preset.fragment)
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            className={`btn small${active ? ' active' : ''}`}
                            onClick={() => togglePreset(preset.fragment)}
                          >
                            {active ? '✓ ' : ''}
                            {preset.label}
                          </button>
                        )
                      })}
                    </div>
                    <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                      Puedes combinar varios presets a la vez (ej. fecha + extensión Office).
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="field full">
                <p className="form-error">{error}</p>
              </div>
            )}

            <div className="field full actions">
              <button
                className="btn btn-labeled"
                type="reset"
                onClick={() => {
                  setForm(EMPTY_FORM)
                  setSelectedFolderIds(new Set())
                  setPattern('')
                  setPatternIsRegex(false)
                }}
              >
                ✕ Limpiar
              </button>
              <button
                className="btn primary btn-labeled"
                type="submit"
                disabled={submitting || (fields.mailbox && !mailboxAccountId)}
              >
                {submitting ? 'Creando…' : '▶ Iniciar análisis'}
              </button>
            </div>
          </div>
        </form>

        <div>
          <div className="panel">
            <div className="panel-head">
              <h3>Resumen del entorno</h3>
              <span>Datos reales</span>
            </div>
            <div className="panel-body summary-stack">
              <div className="summary">
                <div className="summary-icon">✉</div>
                <div>
                  <strong>{stats ? stats.message_count.toLocaleString('es-CL') : '—'}</strong>
                  <span>Mensajes indexados</span>
                </div>
              </div>
              <div className="summary">
                <div className="summary-icon">▣</div>
                <div>
                  <strong>{stats ? stats.attachment_count.toLocaleString('es-CL') : '—'}</strong>
                  <span>Adjuntos trazados</span>
                </div>
              </div>
              <div className="summary">
                <div className="summary-icon">⌁</div>
                <div>
                  <strong>{stats ? stats.conversation_count.toLocaleString('es-CL') : '—'}</strong>
                  <span>Conversaciones correlacionadas</span>
                </div>
              </div>
              <div className="notice">
                <strong>Protección de datos:</strong> el modelo de IA local recibe únicamente el contenido reducido
                del expediente (asunto, remitente enmascarado, vista previa acotada). Los correos no se envían a
                proveedores externos mientras la política sea "solo local".
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
