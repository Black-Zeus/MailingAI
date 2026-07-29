import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  addCaseEvidence,
  addCaseMessage,
  addCaseNote,
  analyzeCaseWithAI,
  createCase,
  createJob,
  deleteCases,
  deleteCase,
  exportCasePdfBlob,
  getCase,
  getCaseEvidenceUrl,
  getJob,
  getLatestAIBatchAnalyze,
  getLatestCaseBatchCreate,
  getCaseChartUrl,
  listCases,
  listJobs,
  listMailboxes,
  listMessages,
  refreshCase,
  refreshOpenCases,
  listCaseShares,
  removeCaseMessage,
  retraceMessageAttachments,
  revokeCaseShare,
  sendCaseEmail,
  shareCase,
  startAIBatchAnalyze,
  startCaseBatchCreate,
  updateAiSummary,
  updateCase,
  updateTimelineEvent,
} from '../api/client'
import type { CaseBatchRunRead, CaseDetail, CaseOutcome, CaseSeedPrefill, CaseShareRead, CaseSummary, CaseType, SeedType } from '../types/cases'
import type { JobRead } from '../types/jobs'
import type { MessageListItem } from '../types/messages'
import { CASE_OUTCOME_LABELS, DETERMINATION_LABELS } from '../types/cases'
import type { AIBatchRunRead } from '../types/ai'
import type { MailboxAccountRead } from '../types/mailboxes'
import { PRIORITY_LABELS } from '../types/ai'
import { ConfirmModal } from '../components/ConfirmModal'
import { ShareModal } from '../components/ShareModal'
import { AttachmentItem } from '../components/AttachmentItem'
import { MessageBodyModal, type MessageBodyModalState } from '../components/MessageBodyModal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDateTime, groupTimelineEvents, stripCorreoSuffix } from '../utils/timeline'
import { toEndOfDayISO, toStartOfDayISO } from '../utils/dates'
import { useBodyScrollLock } from '../utils/modalScrollLock'

const SEED_TYPE_LABELS: Record<SeedType, string> = {
  conversation_id: 'ID de conversación',
  cr_keyword: 'Palabra clave / código CR',
  message_id: 'ID de mensaje puntual',
}

const MAILBOX_SEARCH_FOLDER_LABELS: Record<string, string> = {
  sentitems: 'Enviados',
  inbox: 'Bandeja de entrada',
}

function formatPhaseProgress(count: number, total: number): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return `${count} de ${total} (${pct}%)`
}


interface CasesViewProps {
  prefill: CaseSeedPrefill | null
  onPrefillConsumed: () => void
}

export function CasesView({ prefill, onPrefillConsumed }: CasesViewProps) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [shareCaseTarget, setShareCaseTarget] = useState<CaseSummary | null>(null)
  const [caseShares, setCaseShares] = useState<CaseShareRead[]>([])
  const [sharingCase, setSharingCase] = useState(false)
  const [revokingCaseShareUserId, setRevokingCaseShareUserId] = useState<number | null>(null)

  async function openShareCaseModal(c: CaseSummary) {
    setShareCaseTarget(c)
    try {
      setCaseShares(await listCaseShares(c.case_id))
    } catch (err) {
      setCaseShares([])
      showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar las comparticiones.', true)
    }
  }

  async function handleShareCaseConfirm(userId: number, permission: 'read' | 'edit') {
    if (!shareCaseTarget) return
    setSharingCase(true)
    try {
      await shareCase(shareCaseTarget.case_id, userId, permission)
      showToast('Expediente compartido.')
      setCaseShares(await listCaseShares(shareCaseTarget.case_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo compartir el expediente.', true)
    } finally {
      setSharingCase(false)
    }
  }

  async function handleRevokeCaseShare(userId: number) {
    if (!shareCaseTarget) return
    setRevokingCaseShareUserId(userId)
    try {
      await revokeCaseShare(shareCaseTarget.case_id, userId)
      showToast('Acceso revocado.')
      setCaseShares(await listCaseShares(shareCaseTarget.case_id))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo revocar el acceso.', true)
    } finally {
      setRevokingCaseShareUserId(null)
    }
  }

  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [openCaseIds, setOpenCaseIds] = useState<Set<number>>(new Set())
  const [details, setDetails] = useState<Record<number, CaseDetail>>({})
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [seedType, setSeedType] = useState<SeedType>('conversation_id')
  const [seedValue, setSeedValue] = useState('')
  const [caseType, setCaseType] = useState<CaseType>('custom')

  useEffect(() => {
    if (!prefill) return
    setTitle(prefill.title)
    setSeedType(prefill.seedType)
    setSeedValue(prefill.seedValue)
    setCaseType(prefill.caseType)
    setFormOpen(true)
    onPrefillConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const [analyzingId, setAnalyzingId] = useState<number | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [editingAiSummaryId, setEditingAiSummaryId] = useState<number | null>(null)
  const [aiSummaryDraft, setAiSummaryDraft] = useState('')
  const [savingAiSummaryId, setSavingAiSummaryId] = useState<number | null>(null)
  const [mailboxSearchOpenIds, setMailboxSearchOpenIds] = useState<Set<number>>(new Set())
  const [mailboxQuery, setMailboxQuery] = useState<Record<number, string>>({})
  const [mailboxDateFrom, setMailboxDateFrom] = useState<Record<number, string>>({})
  const [mailboxDateTo, setMailboxDateTo] = useState<Record<number, string>>({})
  const [mailboxJobs, setMailboxJobs] = useState<Record<number, JobRead[]>>({})
  const mailboxPollRefs = useRef<Record<number, number>>({})
  const [mailboxAccounts, setMailboxAccounts] = useState<MailboxAccountRead[]>([])
  const [mailboxSearchAccountId, setMailboxSearchAccountId] = useState<Record<number, number>>({})
  const [deleteTarget, setDeleteTarget] = useState<CaseSummary | null>(null)
  const [deletingCase, setDeletingCase] = useState(false)
  const [addMessageQuery, setAddMessageQuery] = useState<Record<number, string>>({})
  const [addMessageResults, setAddMessageResults] = useState<Record<number, MessageListItem[]>>({})
  const [addMessageSearching, setAddMessageSearching] = useState<number | null>(null)
  const [addingMessageId, setAddingMessageId] = useState<string | null>(null)
  const [exportingCaseId, setExportingCaseId] = useState<number | null>(null)
  const [bodyModal, setBodyModal] = useState<MessageBodyModalState | null>(null)
  const [timelineOpenIds, setTimelineOpenIds] = useState<Set<number>>(new Set())
  const [caseChartOpen, setCaseChartOpen] = useState<Record<number, 'timeline' | 'histogram' | null>>({})
  const [retracingMessageId, setRetracingMessageId] = useState<string | null>(null)
  const [newNoteDraft, setNewNoteDraft] = useState<Record<number, string>>({})
  const [addingNoteId, setAddingNoteId] = useState<number | null>(null)
  const [newEvidenceGlosa, setNewEvidenceGlosa] = useState<Record<number, string>>({})
  const [newEvidenceFile, setNewEvidenceFile] = useState<Record<number, File | null>>({})
  const [addingEvidenceId, setAddingEvidenceId] = useState<number | null>(null)
  const [notesOpenIds, setNotesOpenIds] = useState<Set<number>>(new Set())
  const [evidenceOpenIds, setEvidenceOpenIds] = useState<Set<number>>(new Set())
  const [outcomeDraft, setOutcomeDraft] = useState<Record<number, CaseOutcome | ''>>({})
  const [savingOutcomeId, setSavingOutcomeId] = useState<number | null>(null)
  const [sendEmailTarget, setSendEmailTarget] = useState<number | null>(null)
  const [sendEmailForm, setSendEmailForm] = useState<{
    to: string
    cc: string
    subject: string
    body: string
    mailboxAccountId: number | null
    attachPdf: boolean
    files: File[]
  }>({ to: '', cc: '', subject: '', body: '', mailboxAccountId: null, attachPdf: true, files: [] })
  const [sendingEmail, setSendingEmail] = useState(false)

  function openBodyModal(message: {
    subject: string | null
    body_content: string | null
    body_content_type: string
    body_preview: string | null
    web_link: string | null
  }) {
    setBodyModal({
      subject: message.subject || '(sin asunto)',
      bodyContent: message.body_content,
      bodyContentType: message.body_content_type,
      bodyPreview: message.body_preview,
      webLink: message.web_link,
    })
  }

  async function handleRetraceAttachments(caseId: number, messageId: string) {
    setRetracingMessageId(messageId)
    try {
      const result = await retraceMessageAttachments(messageId)
      const detail = await getCase(caseId)
      setDetails((prev) => ({ ...prev, [caseId]: detail }))
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

  function toggleTimeline(caseId: number) {
    setTimelineOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else {
        next.add(caseId)
      }
      return next
    })
  }

  function toggleNotes(caseId: number) {
    setNotesOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else {
        next.add(caseId)
      }
      return next
    })
  }

  function toggleEvidence(caseId: number) {
    setEvidenceOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else {
        next.add(caseId)
      }
      return next
    })
  }

  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [aiConfirmOpen, setAiConfirmOpen] = useState(false)
  const [clearScope, setClearScope] = useState<'all' | 'open' | 'closed'>('all')
  const [clearing, setClearing] = useState(false)

  const [removeMessageTarget, setRemoveMessageTarget] = useState<{
    caseId: number
    messageId: string
    subject: string
  } | null>(null)
  const [removingMessage, setRemovingMessage] = useState(false)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkCaseType, setBulkCaseType] = useState<CaseType>('cr')
  const [bulkSearchMailbox, setBulkSearchMailbox] = useState(false)
  const [bulkMailboxAccountId, setBulkMailboxAccountId] = useState<number | ''>('')
  const [bulkDateFrom, setBulkDateFrom] = useState('')
  const [bulkDateTo, setBulkDateTo] = useState('')
  useBodyScrollLock(bulkOpen || formOpen || sendEmailTarget !== null)

  const [associatingMail, setAssociatingMail] = useState(false)
  const [formSearchMailbox, setFormSearchMailbox] = useState(false)
  const [formMailboxAccountId, setFormMailboxAccountId] = useState<number | ''>('')
  const [formDateFrom, setFormDateFrom] = useState('')
  const [formDateTo, setFormDateTo] = useState('')

  const [activeCaseBatch, setActiveCaseBatch] = useState<CaseBatchRunRead | null>(null)
  const caseBatchPollRef = useRef<number | null>(null)
  const caseBatchLastProcessedRef = useRef(0)

  const [activeAiBatch, setActiveAiBatch] = useState<AIBatchRunRead | null>(null)
  const aiBatchPollRef = useRef<number | null>(null)

  async function refreshCases() {
    try {
      const data = await listCases()
      setCases(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los casos.')
    }
  }

  useEffect(() => {
    refreshCases()
  }, [])

  function stopAiBatchPolling() {
    if (aiBatchPollRef.current !== null) {
      window.clearInterval(aiBatchPollRef.current)
      aiBatchPollRef.current = null
    }
  }

  function startAiBatchPolling() {
    stopAiBatchPolling()
    aiBatchPollRef.current = window.setInterval(async () => {
      try {
        const batch = await getLatestAIBatchAnalyze()
        setActiveAiBatch(batch)
        if (batch && (batch.status === 'success' || batch.status === 'failed')) {
          stopAiBatchPolling()
          await refreshCases()
          showToast(
            batch.status === 'success'
              ? `Procesamiento con IA terminado: ${batch.succeeded_cases} exitoso(s), ${batch.failed_cases} fallido(s)`
              : 'El procesamiento en lote con IA falló.',
            batch.status === 'failed',
          )
        }
      } catch {
        // se reintenta en el siguiente tick
      }
    }, 4000)
  }

  useEffect(() => {
    // Al montar (incluye recargar la página), retoma un batch que haya quedado corriendo en el
    // backend -- el progreso vive en el servidor, no se pierde con un refresh.
    getLatestAIBatchAnalyze()
      .then((batch) => {
        if (batch && (batch.status === 'queued' || batch.status === 'running')) {
          setActiveAiBatch(batch)
          startAiBatchPolling()
        }
      })
      .catch(() => {})
    return () => stopAiBatchPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopCaseBatchPolling() {
    if (caseBatchPollRef.current !== null) {
      window.clearInterval(caseBatchPollRef.current)
      caseBatchPollRef.current = null
    }
  }

  function startCaseBatchPolling() {
    stopCaseBatchPolling()
    caseBatchLastProcessedRef.current = 0
    caseBatchPollRef.current = window.setInterval(async () => {
      try {
        const batch = await getLatestCaseBatchCreate()
        setActiveCaseBatch(batch)
        if (batch && batch.processed_keywords > caseBatchLastProcessedRef.current) {
          // Cada vez que sube processed_keywords, ya hay un expediente nuevo
          // creado (fase 1) aunque el lote siga corriendo (buscando en el
          // buzón) -- se refresca la lista al toque, no solo al terminar todo.
          caseBatchLastProcessedRef.current = batch.processed_keywords
          await refreshCases()
        }
        if (batch && (batch.status === 'success' || batch.status === 'failed')) {
          stopCaseBatchPolling()
          await refreshCases()
          const created = batch.items.filter((i) => i.status === 'listo').length
          const failed = batch.items.filter((i) => i.status === 'error').length
          showToast(
            batch.status === 'success'
              ? `Creación en lote terminada: ${created} expediente(s) creado(s), ${failed} error(es)`
              : 'La creación en lote falló.',
            batch.status === 'failed',
          )
        }
      } catch {
        // se reintenta en el siguiente tick
      }
    }, 3000)
  }

  useEffect(() => {
    getLatestCaseBatchCreate()
      .then((batch) => {
        if (batch && (batch.status === 'queued' || batch.status === 'running')) {
          setActiveCaseBatch(batch)
          startCaseBatchPolling()
        }
      })
      .catch(() => {})
    return () => stopCaseBatchPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      Object.values(mailboxPollRefs.current).forEach((handle) => window.clearInterval(handle))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    listMailboxes()
      .then(setMailboxAccounts)
      .catch(() => setMailboxAccounts([]))
  }, [])

  useEffect(() => {
    // Retoma cualquier búsqueda en el buzón (por expediente) que haya quedado corriendo en el
    // backend -- el job en sí nunca se cancela con un refresh (vive en mailing.analysis_jobs,
    // igual que cualquier trabajo de "Nueva consulta"), solo se perdía el polling visual y el
    // auto-refresh de correlación al terminar. Se identifica por el case_id que se guarda en
    // los parámetros del job al crearlo.
    listJobs(20)
      .then((jobs) => {
        const byCaseId = new Map<number, JobRead[]>()
        for (const job of jobs) {
          if (
            job.job_type === 'fetch_message_series' &&
            (job.status === 'queued' || job.status === 'running') &&
            typeof job.parameters.case_id === 'number'
          ) {
            const caseId = job.parameters.case_id
            const list = byCaseId.get(caseId) ?? []
            list.push(job)
            byCaseId.set(caseId, list)
          }
        }
        for (const [caseId, caseJobs] of byCaseId) {
          setMailboxJobs((prev) => ({ ...prev, [caseId]: caseJobs }))
          setMailboxSearchOpenIds((prev) => new Set(prev).add(caseId))
          setOpenCaseIds((prev) => new Set(prev).add(caseId))
          if (!details[caseId]) {
            getCase(caseId)
              .then((detail) => setDetails((prev) => ({ ...prev, [caseId]: detail })))
              .catch(() => {})
          }
          startMailboxPoll(
            caseId,
            caseJobs.map((j) => j.job_id),
          )
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleCase(caseId: number) {
    setOpenCaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else {
        next.add(caseId)
      }
      return next
    })
    if (!details[caseId]) {
      try {
        const detail = await getCase(caseId)
        setDetails((prev) => ({ ...prev, [caseId]: detail }))
        setOutcomeDraft((prev) => ({ ...prev, [caseId]: detail.outcome ?? '' }))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'No se pudo cargar el caso.')
      }
    }
  }

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null)

  async function handleToggleStatus(caseId: number, nextStatus: 'open' | 'closed') {
    setTogglingStatusId(caseId)
    try {
      const updated = await updateCase(caseId, { status: nextStatus })
      setDetails((prev) => ({ ...prev, [caseId]: updated }))
      await refreshCases()
      showToast(nextStatus === 'closed' ? 'Expediente cerrado' : 'Expediente reabierto')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado del expediente.', true)
    } finally {
      setTogglingStatusId(null)
    }
  }

  async function handleSaveOutcome(caseId: number) {
    setSavingOutcomeId(caseId)
    try {
      const updated = await updateCase(caseId, { outcome: outcomeDraft[caseId] || null })
      setDetails((prev) => ({ ...prev, [caseId]: updated }))
      await refreshCases()
      showToast('Conclusión del expediente guardada')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo guardar la conclusión.', true)
    } finally {
      setSavingOutcomeId(null)
    }
  }

  async function handleAddNote(caseId: number) {
    const body = (newNoteDraft[caseId] ?? '').trim()
    if (!body) return
    setAddingNoteId(caseId)
    try {
      const note = await addCaseNote(caseId, body)
      setDetails((prev) => {
        const current = prev[caseId]
        if (!current) return prev
        return { ...prev, [caseId]: { ...current, notes: [...current.notes, note] } }
      })
      setNewNoteDraft((prev) => ({ ...prev, [caseId]: '' }))
      showToast('Nota agregada')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo agregar la nota.', true)
    } finally {
      setAddingNoteId(null)
    }
  }

  async function handleAddEvidence(caseId: number) {
    const glosa = (newEvidenceGlosa[caseId] ?? '').trim()
    const file = newEvidenceFile[caseId]
    if (!glosa || !file) return
    setAddingEvidenceId(caseId)
    try {
      const evidence = await addCaseEvidence(caseId, glosa, file)
      setDetails((prev) => {
        const current = prev[caseId]
        if (!current) return prev
        return { ...prev, [caseId]: { ...current, evidence: [...current.evidence, evidence] } }
      })
      setNewEvidenceGlosa((prev) => ({ ...prev, [caseId]: '' }))
      setNewEvidenceFile((prev) => ({ ...prev, [caseId]: null }))
      showToast('Evidencia agregada')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo agregar la evidencia.', true)
    } finally {
      setAddingEvidenceId(null)
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (seedType === 'cr_keyword' && formSearchMailbox && formMailboxAccountId === '') {
      setError('Elige el buzón donde buscar.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      if (seedType === 'cr_keyword' && formSearchMailbox) {
        // Se reutiliza el mecanismo de "Crear en lote" con un solo codigo --
        // asi el expediente se crea primero (correlacion local, rapido) y la
        // busqueda en el buzon real corre despues en el backend, sin bloquear
        // este submit por minutos esperando a Graph.
        const batch = await startCaseBatchCreate([seedValue], caseType, {
          search_mailbox: true,
          mailbox_account_id: formMailboxAccountId as number,
          date_from: formDateFrom || undefined,
          date_to: formDateTo || undefined,
        })
        setActiveCaseBatch(batch)
        startCaseBatchPolling()
        showToast('Expediente en creación — buscando también en el buzón real.')
      } else {
        const result = await createCase(title, seedType, seedValue, caseType)
        showToast(`Expediente "${result.title}" creado con ${result.message_count} mensaje(s) correlacionado(s)`)
        await refreshCases()
      }
      setTitle('')
      setSeedValue('')
      setFormOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el expediente.')
    } finally {
      setCreating(false)
    }
  }

  async function handleAnalyze(caseId: number) {
    setAnalyzingId(caseId)
    try {
      const result = await analyzeCaseWithAI(caseId)
      if (result.status !== 'success') {
        showToast(result.error_message || `El análisis terminó en estado "${result.status}".`, true)
      } else {
        showToast('Análisis de IA completado')
      }
      const detail = await getCase(caseId)
      setDetails((prev) => ({ ...prev, [caseId]: detail }))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo analizar el caso con IA.', true)
    } finally {
      setAnalyzingId(null)
    }
  }

  function startEditAiSummary(caseId: number, currentText: string) {
    setEditingAiSummaryId(caseId)
    setAiSummaryDraft(currentText)
  }

  function cancelEditAiSummary() {
    setEditingAiSummaryId(null)
    setAiSummaryDraft('')
  }

  async function handleSaveAiSummary(caseId: number) {
    const trimmed = aiSummaryDraft.trim()
    if (!trimmed) return
    setSavingAiSummaryId(caseId)
    try {
      const detail = await updateAiSummary(caseId, trimmed)
      setDetails((prev) => ({ ...prev, [caseId]: detail }))
      setEditingAiSummaryId(null)
      showToast('Resumen de IA actualizado')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo actualizar el resumen.', true)
    } finally {
      setSavingAiSummaryId(null)
    }
  }

  function openSendEmailModal(caseId: number) {
    const detail = details[caseId]
    const lastMessage = detail && detail.messages.length > 0 ? detail.messages[detail.messages.length - 1] : null
    const toSet = new Set<string>()
    if (lastMessage?.from_address) toSet.add(lastMessage.from_address)
    for (const addr of lastMessage?.to_addresses ?? []) toSet.add(addr)
    const ccSet = new Set<string>(lastMessage?.cc_addresses ?? [])
    const defaultMailboxId =
      mailboxAccounts.find((m) => m.enabled && m.mailbox_account_id === lastMessage?.mailbox_account_id)
        ?.mailbox_account_id ?? mailboxAccounts.find((m) => m.enabled)?.mailbox_account_id ?? null
    setSendEmailForm({
      to: Array.from(toSet).join('; '),
      cc: Array.from(ccSet).join('; '),
      subject: lastMessage?.subject ? `RE: ${lastMessage.subject}` : `Expediente ${detail?.title ?? ''}`,
      body: '',
      mailboxAccountId: defaultMailboxId,
      attachPdf: true,
      files: [],
    })
    setSendEmailTarget(caseId)
  }

  function closeSendEmailModal() {
    setSendEmailTarget(null)
  }

  async function handleSendEmail() {
    if (!sendEmailTarget) return
    if (!sendEmailForm.to.trim() || !sendEmailForm.subject.trim() || !sendEmailForm.body.trim() || !sendEmailForm.mailboxAccountId) {
      showToast('Completa para, asunto, cuerpo y buzón de envío.', true)
      return
    }
    setSendingEmail(true)
    try {
      await sendCaseEmail(sendEmailTarget, {
        to: sendEmailForm.to,
        cc: sendEmailForm.cc,
        subject: sendEmailForm.subject,
        body: sendEmailForm.body,
        mailboxAccountId: sendEmailForm.mailboxAccountId,
        attachCasePdf: sendEmailForm.attachPdf,
        attachments: sendEmailForm.files,
      })
      showToast('Correo enviado')
      setSendEmailTarget(null)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo enviar el correo.', true)
    } finally {
      setSendingEmail(false)
    }
  }

  async function handleRefreshCorrelation(caseId: number) {
    setRefreshingId(caseId)
    try {
      const result = await refreshCase(caseId)
      setDetails((prev) => ({ ...prev, [caseId]: result.case }))
      await refreshCases()
      if (result.new_messages_found === 0) {
        showToast('No se encontraron correos nuevos relacionados.')
      } else {
        showToast(
          `${result.new_messages_found} correo(s) nuevo(s) agregado(s) al expediente`,
        )
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo buscar correos relacionados.', true)
    } finally {
      setRefreshingId(null)
    }
  }

  function toggleMailboxSearch(caseId: number, externalCode: string | null) {
    setMailboxSearchOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else {
        next.add(caseId)
        setMailboxQuery((q) => (q[caseId] !== undefined ? q : { ...q, [caseId]: externalCode || '' }))
        setMailboxSearchAccountId((sel) => {
          if (sel[caseId] !== undefined) return sel
          const firstEnabled = mailboxAccounts.find((m) => m.enabled)
          return firstEnabled ? { ...sel, [caseId]: firstEnabled.mailbox_account_id } : sel
        })
      }
      return next
    })
  }

  function stopMailboxPoll(caseId: number) {
    const handle = mailboxPollRefs.current[caseId]
    if (handle !== undefined) {
      window.clearInterval(handle)
      delete mailboxPollRefs.current[caseId]
    }
  }

  function startMailboxPoll(caseId: number, jobIds: string[]) {
    stopMailboxPoll(caseId)
    const poll = async () => {
      try {
        const jobs = await Promise.all(jobIds.map((id) => getJob(id)))
        setMailboxJobs((prev) => ({ ...prev, [caseId]: jobs }))
        const allDone = jobs.every((j) => j.status === 'success' || j.status === 'failed' || j.status === 'cancelled')
        if (allDone) {
          stopMailboxPoll(caseId)
          const totalIndexed = jobs.reduce((sum, j) => sum + j.processed_items, 0)
          const anyFailed = jobs.some((j) => j.status === 'failed')
          showToast(
            anyFailed
              ? 'La búsqueda en el buzón terminó con errores en alguna carpeta — revisa el detalle.'
              : `Búsqueda en el buzón terminada — ${totalIndexed} mensaje(s) indexado(s) (Enviados + Bandeja de entrada). Vinculando al expediente…`,
            anyFailed,
          )
          await handleRefreshCorrelation(caseId)
        }
      } catch {
        // se reintenta en el siguiente tick
      }
    }
    poll()
    mailboxPollRefs.current[caseId] = window.setInterval(poll, 4000)
  }

  async function handleSearchMailbox(caseId: number) {
    const query = (mailboxQuery[caseId] || '').trim()
    if (!query) return
    if (!mailboxSearchAccountId[caseId]) {
      showToast('Selecciona un buzón antes de buscar — todo trabajo debe quedar asociado a una cuenta concreta.', true)
      return
    }
    try {
      // Se busca en Enviados y Bandeja de entrada en paralelo -- Graph no
      // admite pedir ambas carpetas en una sola llamada, y confirmamos en vivo
      // que sin carpeta especifica /me/messages no trae Elementos Enviados en
      // este tenant.
      const folders = ['sentitems', 'inbox'] as const
      const created = await Promise.all(
        folders.map((folder) =>
          createJob('fetch_message_series', {
            subject_contains: query,
            date_from: mailboxDateFrom[caseId] ? toStartOfDayISO(mailboxDateFrom[caseId]) : undefined,
            date_to: mailboxDateTo[caseId] ? toEndOfDayISO(mailboxDateTo[caseId]) : undefined,
            top: 200,
            mailbox_account_id: mailboxSearchAccountId[caseId],
            folder,
            // Marca de donde vino el job -- n8n la ignora (no la referencia ningun nodo),
            // pero permite retomar el polling + el auto-refresh de correlacion si se
            // recarga la página mientras el job todavía está corriendo (ver mount effect).
            case_id: caseId,
          }),
        ),
      )
      const placeholders: JobRead[] = created.map((job, idx) => ({
        job_id: job.job_id,
        job_type: 'fetch_message_series',
        status: 'queued',
        current_stage: null,
        parameters: { folder: folders[idx] },
        result_count: null,
        processed_items: 0,
        total_items: null,
        progress_percentage: null,
        requested_at: job.created_at,
        started_at: null,
        finished_at: null,
        error_code: null,
        error_message: null,
        retry_count: 0,
        retry_of_job_id: null,
        fetch_run_id: null,
        chart_id: null,
      }))
      setMailboxJobs((prev) => ({ ...prev, [caseId]: placeholders }))
      startMailboxPoll(
        caseId,
        created.map((j) => j.job_id),
      )
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo iniciar la búsqueda en el buzón.', true)
    }
  }

  async function handleExportCase(caseId: number, title: string) {
    setExportingCaseId(caseId)
    try {
      const blob = await exportCasePdfBlob(caseId)
      const url = URL.createObjectURL(blob)
      const safeTitle = title.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]/g, '').trim().slice(0, 60) || 'expediente'
      const link = document.createElement('a')
      link.href = url
      link.download = `expediente_${caseId}_${safeTitle}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo exportar el expediente.', true)
    } finally {
      setExportingCaseId(null)
    }
  }

  async function handleSearchMessageToAdd(caseId: number) {
    const query = (addMessageQuery[caseId] || '').trim()
    if (!query) return
    setAddMessageSearching(caseId)
    try {
      const results = await listMessages({ subject_contains: query, limit: 15 })
      setAddMessageResults((prev) => ({ ...prev, [caseId]: results }))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo buscar correos.', true)
    } finally {
      setAddMessageSearching(null)
    }
  }

  function handleClearMessageSearch(caseId: number) {
    setAddMessageQuery((prev) => ({ ...prev, [caseId]: '' }))
    setAddMessageResults((prev) => {
      const next = { ...prev }
      delete next[caseId]
      return next
    })
  }

  async function handleAddMessageToCase(caseId: number, messageId: string) {
    setAddingMessageId(messageId)
    try {
      const detail = await addCaseMessage(caseId, messageId)
      setDetails((prev) => ({ ...prev, [caseId]: detail }))
      await refreshCases()
      showToast('Correo agregado al expediente')
      setAddMessageResults((prev) => ({ ...prev, [caseId]: [] }))
      setAddMessageQuery((prev) => ({ ...prev, [caseId]: '' }))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo agregar el correo.', true)
    } finally {
      setAddingMessageId(null)
    }
  }

  async function handleDeleteCase() {
    if (!deleteTarget) return
    setDeletingCase(true)
    try {
      await deleteCase(deleteTarget.case_id)
      showToast(`Expediente "${deleteTarget.title}" eliminado`)
      setDeleteTarget(null)
      setDetails((prev) => {
        const next = { ...prev }
        delete next[deleteTarget.case_id]
        return next
      })
      setOpenCaseIds((prev) => {
        const next = new Set(prev)
        next.delete(deleteTarget.case_id)
        return next
      })
      await refreshCases()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo eliminar el expediente.', true)
    } finally {
      setDeletingCase(false)
    }
  }

  async function handleRemoveMessage() {
    if (!removeMessageTarget) return
    setRemovingMessage(true)
    try {
      const detail = await removeCaseMessage(removeMessageTarget.caseId, removeMessageTarget.messageId)
      setDetails((prev) => ({ ...prev, [removeMessageTarget.caseId]: detail }))
      await refreshCases()
      showToast('Correo quitado del expediente')
      setRemoveMessageTarget(null)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo quitar el correo.', true)
    } finally {
      setRemovingMessage(false)
    }
  }

  function parseBulkKeywords(): string[] {
    return Array.from(
      new Set(
        bulkText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
    )
  }

  async function handleAssociateMail() {
    setAssociatingMail(true)
    try {
      const result = await refreshOpenCases()
      await refreshCases()
      showToast(
        `Revisados ${result.cases_checked} expediente(s) abierto(s) — ${result.cases_with_new_messages} con correos nuevos (${result.new_messages_found} en total)${result.errors > 0 ? `, ${result.errors} error(es)` : ''}.`,
        result.errors > 0,
      )
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo asociar correos a los expedientes abiertos.', true)
    } finally {
      setAssociatingMail(false)
    }
  }

  async function handleBulkCreate() {
    const keywords = parseBulkKeywords()
    if (keywords.length === 0) return
    if (bulkSearchMailbox && bulkMailboxAccountId === '') {
      showToast('Elige el buzón donde buscar.', true)
      return
    }
    try {
      const batch = await startCaseBatchCreate(keywords, bulkCaseType, {
        search_mailbox: bulkSearchMailbox,
        mailbox_account_id: bulkSearchMailbox ? (bulkMailboxAccountId as number) : undefined,
        date_from: bulkSearchMailbox && bulkDateFrom ? bulkDateFrom : undefined,
        date_to: bulkSearchMailbox && bulkDateTo ? bulkDateTo : undefined,
      })
      setActiveCaseBatch(batch)
      startCaseBatchPolling()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo iniciar la creación en lote.', true)
    }
  }

  async function handleConfirmProcessAllWithAI() {
    setAiConfirmOpen(false)
    await handleProcessAllWithAI()
  }

  async function handleProcessAllWithAI() {
    try {
      const batch = await startAIBatchAnalyze()
      if (batch.total_cases === 0) {
        showToast('Todos los expedientes ya tienen un análisis de IA exitoso.')
        return
      }
      setActiveAiBatch(batch)
      startAiBatchPolling()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo iniciar el procesamiento en lote.', true)
    }
  }

  async function validateEvent(caseId: number, eventId: number) {
    try {
      await updateTimelineEvent(eventId, 'validacion_manual')
      const detail = await getCase(caseId)
      setDetails((prev) => ({ ...prev, [caseId]: detail }))
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo validar el evento.', true)
    }
  }

  async function handleClear() {
    setClearing(true)
    try {
      const result = await deleteCases(clearScope)
      showToast(`${result.deleted} expediente(s) eliminado(s)`)
      setClearModalOpen(false)
      setDetails({})
      setOpenCaseIds(new Set())
      await refreshCases()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo limpiar los expedientes.', true)
    } finally {
      setClearing(false)
    }
  }

  const total = cases?.length ?? 0
  const open = cases?.filter((c) => c.status === 'open').length ?? 0
  const closed = cases?.filter((c) => c.status === 'closed').length ?? 0
  const totalMessages = cases?.reduce((sum, c) => sum + c.message_count, 0) ?? 0

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Expedientes detectados</h2>
          <p>Procesos reconstruidos desde correos, conversaciones y documentos relacionados.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn danger btn-labeled" onClick={() => setClearModalOpen(true)}>
            🗑 Limpiar expedientes
          </button>
          <button
            type="button"
            className="btn btn-labeled"
            onClick={handleAssociateMail}
            disabled={associatingMail}
            title="Vuelve a correlacionar todos los expedientes abiertos contra lo ya indexado -- útil si otro trabajo trajo correos nuevos que corresponden a un expediente existente"
          >
            {associatingMail ? 'Asociando correos…' : '🔗 Asociar correos'}
          </button>
          <button
            type="button"
            className="btn btn-labeled"
            onClick={() => setAiConfirmOpen(true)}
            disabled={(activeAiBatch !== null && activeAiBatch.status !== 'success' && activeAiBatch.status !== 'failed') || cases === null}
          >
            {activeAiBatch && (activeAiBatch.status === 'queued' || activeAiBatch.status === 'running')
              ? `Procesando con IA… (${activeAiBatch.processed_cases}/${activeAiBatch.total_cases})`
              : '🤖 Procesar todo con IA'}
          </button>
          <button type="button" className="btn btn-labeled" onClick={() => setBulkOpen((v) => !v)}>
            {activeCaseBatch && (activeCaseBatch.status === 'queued' || activeCaseBatch.status === 'running')
              ? `Creando… (${activeCaseBatch.processed_keywords}/${activeCaseBatch.total_keywords})`
              : bulkOpen
                ? '✕ Cerrar creación en lote'
                : '＋ Crear en lote'}
          </button>
          <button type="button" className="btn primary btn-labeled" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? '✕ Cerrar formulario' : '＋ Nuevo expediente'}
          </button>
        </div>
      </div>

      {activeCaseBatch && (activeCaseBatch.status === 'queued' || activeCaseBatch.status === 'running') && (
        <div
          className="panel"
          style={{
            marginBottom: 20,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>Creando expedientes en lote…</strong>
            <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: 13 }}>
              Creando expedientes: {formatPhaseProgress(activeCaseBatch.created_count, activeCaseBatch.total_keywords)}
            </p>
            <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 13 }}>
              Asociando mail indexados: {formatPhaseProgress(activeCaseBatch.correlated_count, activeCaseBatch.total_keywords)}
            </p>
            {activeCaseBatch.search_mailbox && (
              <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 13 }}>
                Buscando en buzones: {formatPhaseProgress(activeCaseBatch.searched_count, activeCaseBatch.total_keywords)}
              </p>
            )}
          </div>
          <button type="button" className="btn small btn-labeled" onClick={() => setBulkOpen(true)}>
            🔍 Ver detalle
          </button>
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <span>Expedientes</span>
          <strong>{total}</strong>
        </div>
        <div className="kpi">
          <span>Abiertos</span>
          <strong style={{ color: 'var(--warning)' }}>{open}</strong>
        </div>
        <div className="kpi">
          <span>Cerrados</span>
          <strong style={{ color: 'var(--success)' }}>{closed}</strong>
        </div>
        <div className="kpi">
          <span>Mensajes correlacionados</span>
          <strong style={{ color: 'var(--accent-2)' }}>{totalMessages}</strong>
        </div>
      </div>

      <div
        className={`modal-backdrop${bulkOpen ? ' open' : ''}`}
      >
        <div className="modal medium">
          <div className="modal-body">
            <h3>Crear expedientes en lote</h3>
            <p>Un código/palabra clave por línea</p>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field full">
                <label htmlFor="bulkKeywords">Códigos (uno por línea)</label>
                <textarea
                  id="bulkKeywords"
                  rows={8}
                  placeholder={'GFCH-I-069926\nGFCH-I-074270\n...'}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  disabled={activeCaseBatch !== null && activeCaseBatch.status !== 'success' && activeCaseBatch.status !== 'failed'}
                />
                <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                  Cada línea se busca por asunto, cuerpo y nombre de adjuntos — se crea un expediente por línea, con
                  ese texto como título y como código externo. La corrida queda guardada en el servidor: si se recarga
                  la página mientras está en curso, retoma el progreso real automáticamente.
                </p>
              </div>
              <div className="field">
                <label htmlFor="bulkCaseType">Tipo</label>
                <select
                  id="bulkCaseType"
                  value={bulkCaseType}
                  onChange={(e) => setBulkCaseType(e.target.value as CaseType)}
                  disabled={activeCaseBatch !== null && activeCaseBatch.status !== 'success' && activeCaseBatch.status !== 'failed'}
                >
                  <option value="cr">CR</option>
                  <option value="custom">Personalizado</option>
                  <option value="conversation">Conversación</option>
                </select>
              </div>
              <div className="field full">
                <label htmlFor="bulkSearchMailbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    id="bulkSearchMailbox"
                    type="checkbox"
                    checked={bulkSearchMailbox}
                    onChange={(e) => setBulkSearchMailbox(e.target.checked)}
                    disabled={activeCaseBatch !== null && activeCaseBatch.status !== 'success' && activeCaseBatch.status !== 'failed'}
                    style={{ width: 'auto' }}
                  />
                  Buscar también en el buzón real (no solo lo ya indexado)
                </label>
                <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                  Antes de correlacionar cada código, se busca en Microsoft Graph (Elementos Enviados) dentro del
                  rango de fechas — más lento, pero no depende de que alguien haya corrido esa búsqueda a mano antes.
                </p>
              </div>
              {bulkSearchMailbox && (
                <>
                  <div className="field">
                    <label htmlFor="bulkMailboxAccountId">Buzón</label>
                    <select
                      id="bulkMailboxAccountId"
                      value={bulkMailboxAccountId}
                      onChange={(e) => setBulkMailboxAccountId(e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">Elige un buzón…</option>
                      {mailboxAccounts
                        .filter((m) => m.enabled)
                        .map((m) => (
                          <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="bulkDateFrom">Desde (default: últimos 6 meses)</label>
                    <input
                      id="bulkDateFrom"
                      type="date"
                      value={bulkDateFrom}
                      onChange={(e) => setBulkDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="bulkDateTo">Hasta (default: hoy)</label>
                    <input id="bulkDateTo" type="date" value={bulkDateTo} onChange={(e) => setBulkDateTo(e.target.value)} />
                  </div>
                </>
              )}
              <div className="field full actions">
                <button
                  type="button"
                  className="btn primary btn-labeled"
                  onClick={handleBulkCreate}
                  disabled={
                    (activeCaseBatch !== null && activeCaseBatch.status !== 'success' && activeCaseBatch.status !== 'failed') ||
                    parseBulkKeywords().length === 0
                  }
                >
                  {activeCaseBatch && (activeCaseBatch.status === 'queued' || activeCaseBatch.status === 'running')
                    ? `Creando… (${activeCaseBatch.processed_keywords}/${activeCaseBatch.total_keywords})`
                    : `＋ Crear ${parseBulkKeywords().length || ''} expediente(s)`}
                </button>
              </div>
              {activeCaseBatch && activeCaseBatch.items.length > 0 && (
                <div className="field full panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeCaseBatch.items.map((p) => (
                        <tr key={p.item_id}>
                          <td className="mono">{p.keyword}</td>
                          <td>
                            {p.status === 'pendiente' && <span style={{ color: 'var(--muted)' }}>Pendiente</span>}
                            {p.status === 'creando' && <span>{p.detail || 'Creando…'}</span>}
                            {p.status === 'listo' && <span className="badge success">Listo — {p.detail}</span>}
                            {p.status === 'error' && <span className="badge failed">Error — {p.detail}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn small btn-labeled" onClick={() => setBulkOpen(false)}>
              ✕ Cerrar
            </button>
          </div>
        </div>
      </div>

      <div
        className={`modal-backdrop${formOpen ? ' open' : ''}`}
      >
        <div className="modal medium">
          <form onSubmit={handleCreate}>
            <div className="modal-body">
              <h3>Nuevo expediente</h3>
              <p>Correlación por hilo, código CR o mensaje puntual</p>
              <div className="form-grid" style={{ marginTop: 14 }}>
                <div className="field full">
                  <label htmlFor="caseTitle">Título</label>
                  <input id="caseTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="seedType">Semilla</label>
                  <select id="seedType" value={seedType} onChange={(e) => setSeedType(e.target.value as SeedType)}>
                    {Object.entries(SEED_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="seedValue">Valor</label>
                  <input
                    id="seedValue"
                    type="text"
                    value={seedValue}
                    onChange={(e) => setSeedValue(e.target.value)}
                    required
                    placeholder={seedType === 'cr_keyword' ? 'ej. R-086155' : 'ej. AAQkAD...'}
                  />
                </div>
                <div className="field">
                  <label htmlFor="caseType">Tipo</label>
                  <select id="caseType" value={caseType} onChange={(e) => setCaseType(e.target.value as CaseType)}>
                    <option value="custom">Personalizado</option>
                    <option value="conversation">Conversación</option>
                    <option value="cr">CR</option>
                  </select>
                </div>
                {seedType === 'cr_keyword' && (
                  <div className="field full">
                    <label htmlFor="formSearchMailbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        id="formSearchMailbox"
                        type="checkbox"
                        checked={formSearchMailbox}
                        onChange={(e) => setFormSearchMailbox(e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      Buscar también en el buzón real (no solo lo ya indexado)
                    </label>
                    <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                      El expediente se crea primero con lo ya indexado; la búsqueda en Microsoft Graph (Enviados +
                      Bandeja de entrada) corre después en segundo plano y se ve en la card de progreso.
                    </p>
                  </div>
                )}
                {seedType === 'cr_keyword' && formSearchMailbox && (
                  <>
                    <div className="field">
                      <label htmlFor="formMailboxAccountId">Buzón</label>
                      <select
                        id="formMailboxAccountId"
                        value={formMailboxAccountId}
                        onChange={(e) => setFormMailboxAccountId(e.target.value ? Number(e.target.value) : '')}
                      >
                        <option value="">Elige un buzón…</option>
                        {mailboxAccounts
                          .filter((m) => m.enabled)
                          .map((m) => (
                            <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                              {m.label}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="formDateFrom">Desde (default: últimos 6 meses)</label>
                      <input
                        id="formDateFrom"
                        type="date"
                        value={formDateFrom}
                        onChange={(e) => setFormDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="formDateTo">Hasta (default: hoy)</label>
                      <input id="formDateTo" type="date" value={formDateTo} onChange={(e) => setFormDateTo(e.target.value)} />
                    </div>
                  </>
                )}
                {error && (
                  <div className="field full">
                    <p className="form-error">{error}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn small btn-labeled" onClick={() => setFormOpen(false)}>
                ✕ Cancelar
              </button>
              <button className="btn primary btn-labeled" type="submit" disabled={creating}>
                {creating ? 'Correlacionando…' : '＋ Crear expediente'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Resultados</h3>
          <span>{total} {total === 1 ? 'expediente' : 'expedientes'}</span>
        </div>
        <div className="panel-body case-list">
          {cases !== null && cases.length === 0 && (
            <div className="empty-view">
              <strong>No existen expedientes almacenados.</strong>
              <p>Crea uno nuevo a partir de un hilo, un código CR, o un mensaje puntual.</p>
            </div>
          )}
          {cases?.map((c) => {
            const isOpen = openCaseIds.has(c.case_id)
            const detail = details[c.case_id]
            const latestAiRun = detail?.latest_ai_run
            const aiResult = latestAiRun?.result
            const isClosed = c.status === 'closed'
            const isSinHallazgos = c.outcome === 'sin_hallazgos'
            return (
              <article className={`case-card${isOpen ? ' open' : ''}`} key={c.case_id}>
                <div className="case-summary" onClick={() => toggleCase(c.case_id)}>
                  <div>
                    <h4>{c.title}</h4>
                    <div className="case-meta">
                      <span>{c.message_count} mensajes</span>
                      <span>
                        {formatDateTime(c.first_message_at)} → {formatDateTime(c.last_message_at)}
                      </span>
                      {c.external_code && <span>Código: {c.external_code}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {c.has_own_reply ? (
                      <span className="badge success" title="El buzón auditado ya envió una respuesta dentro de este expediente">
                        Respondido
                      </span>
                    ) : (
                      <span className="badge queued" title="Ningún correo del expediente fue enviado desde el buzón auditado todavía">
                        Sin respuesta propia
                      </span>
                    )}
                    {c.outcome && (
                      <span
                        className={`badge ${
                          c.outcome === 'con_hallazgos'
                            ? 'failed'
                            : c.outcome === 'sin_hallazgos'
                              ? 'success'
                              : c.outcome === 'derivado' || c.outcome === 'mas_antecedentes'
                                ? 'queued'
                                : c.outcome === 'en_proceso'
                                  ? 'running'
                                  : 'cancelled'
                        }`}
                      >
                        {CASE_OUTCOME_LABELS[c.outcome]}
                      </span>
                    )}
                    {c.has_successful_ai_run && !c.ai_stale && <span className="badge success">IA ✓</span>}
                    {c.has_successful_ai_run && c.ai_stale && (
                      <span className="badge failed">IA desactualizada</span>
                    )}
                    {!c.has_successful_ai_run && <span className="badge cancelled">Sin analizar</span>}
                    <span className={`badge ${c.status}`}>{c.status === 'open' ? 'Abierto' : 'Cerrado'}</span>
                  </div>
                </div>
                {isOpen && (
                  <div className="case-detail">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        onClick={() => handleRefreshCorrelation(c.case_id)}
                        disabled={refreshingId === c.case_id || isClosed}
                        data-tooltip={refreshingId === c.case_id ? 'Buscando correos relacionados…' : 'Buscar correos relacionados'}
                        aria-label="Buscar correos relacionados"
                      >
                        {refreshingId === c.case_id ? '…' : '🔍'}
                      </button>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        onClick={() => toggleMailboxSearch(c.case_id, c.external_code)}
                        disabled={isClosed}
                        data-tooltip={mailboxSearchOpenIds.has(c.case_id) ? 'Cerrar búsqueda en el buzón' : 'Buscar en el buzón (Graph)'}
                        aria-label="Buscar en el buzón (Graph)"
                      >
                        📥
                      </button>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        onClick={() => handleAnalyze(c.case_id)}
                        disabled={analyzingId === c.case_id || isClosed || isSinHallazgos}
                        data-tooltip={analyzingId === c.case_id ? 'Analizando con IA…' : 'Analizar con IA'}
                        aria-label="Analizar con IA"
                      >
                        {analyzingId === c.case_id ? '…' : '🤖'}
                      </button>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        disabled={exportingCaseId === c.case_id}
                        onClick={() => handleExportCase(c.case_id, c.title)}
                        data-tooltip={exportingCaseId === c.case_id ? 'Generando PDF…' : 'Exportar expediente (PDF)'}
                        aria-label="Exportar expediente (PDF)"
                      >
                        {exportingCaseId === c.case_id ? '…' : '📄'}
                      </button>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        disabled={!detail || detail.messages.length === 0}
                        onClick={() => openSendEmailModal(c.case_id)}
                        data-tooltip="Enviar correo"
                        aria-label="Enviar correo"
                      >
                        ✉
                      </button>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        disabled={togglingStatusId === c.case_id || (!isClosed && isSinHallazgos)}
                        onClick={() => handleToggleStatus(c.case_id, c.status === 'open' ? 'closed' : 'open')}
                        data-tooltip={
                          togglingStatusId === c.case_id
                            ? 'Guardando…'
                            : c.status === 'open'
                              ? 'Cerrar expediente'
                              : 'Reabrir expediente'
                        }
                        aria-label={c.status === 'open' ? 'Cerrar expediente' : 'Reabrir expediente'}
                      >
                        {togglingStatusId === c.case_id ? '…' : c.status === 'open' ? '🔒' : '🔓'}
                      </button>
                      {(isAdmin || c.owner_user_id === user?.user_id) && (
                        <button
                          type="button"
                          className="btn small icon-btn"
                          onClick={() => openShareCaseModal(c)}
                          data-tooltip="Compartir"
                          aria-label="Compartir"
                        >
                          🔗
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn small danger icon-btn"
                        onClick={() => setDeleteTarget(c)}
                        style={{ marginLeft: 'auto' }}
                        data-tooltip="Eliminar expediente"
                        aria-label="Eliminar expediente"
                      >
                        🗑
                      </button>
                    </div>
                    {mailboxSearchOpenIds.has(c.case_id) && (
                      <div className="add-message-search" style={{ marginTop: 10 }}>
                        <label>
                          "Buscar correos relacionados" solo busca dentro de lo ya indexado localmente — esto en
                          cambio trae correos nuevos desde el buzón real (Graph) que contengan el texto en asunto o
                          cuerpo, los indexa, y automáticamente vuelve a correlacionar el expediente.
                        </label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          <div className="field" style={{ flex: 1, minWidth: 200 }}>
                            <label htmlFor={`mailbox-query-${c.case_id}`} style={{ fontSize: 11 }}>
                              Texto (asunto + cuerpo, admite -excluir)
                            </label>
                            <input
                              id={`mailbox-query-${c.case_id}`}
                              type="text"
                              value={mailboxQuery[c.case_id] ?? ''}
                              onChange={(e) => setMailboxQuery((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`mailbox-from-${c.case_id}`} style={{ fontSize: 11 }}>
                              Desde
                            </label>
                            <input
                              id={`mailbox-from-${c.case_id}`}
                              type="date"
                              value={mailboxDateFrom[c.case_id] ?? ''}
                              onChange={(e) => setMailboxDateFrom((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`mailbox-to-${c.case_id}`} style={{ fontSize: 11 }}>
                              Hasta
                            </label>
                            <input
                              id={`mailbox-to-${c.case_id}`}
                              type="date"
                              value={mailboxDateTo[c.case_id] ?? ''}
                              onChange={(e) => setMailboxDateTo((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`mailbox-account-${c.case_id}`} style={{ fontSize: 11 }}>
                              Buzón
                            </label>
                            <select
                              id={`mailbox-account-${c.case_id}`}
                              value={mailboxSearchAccountId[c.case_id] ?? ''}
                              onChange={(e) =>
                                setMailboxSearchAccountId((prev) => ({ ...prev, [c.case_id]: Number(e.target.value) }))
                              }
                            >
                              {mailboxAccounts.filter((m) => m.enabled).length === 0 && (
                                <option value="">Sin buzones habilitados</option>
                              )}
                              {mailboxAccounts
                                .filter((m) => m.enabled)
                                .map((m) => (
                                  <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                                    {m.label}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="btn small primary icon-btn"
                            disabled={
                              !(mailboxQuery[c.case_id] ?? '').trim() ||
                              !mailboxSearchAccountId[c.case_id] ||
                              (mailboxJobs[c.case_id] ?? []).some((j) => j.status === 'queued' || j.status === 'running')
                            }
                            onClick={() => handleSearchMailbox(c.case_id)}
                            data-tooltip="Buscar"
                            aria-label="Buscar"
                          >
                            🔍
                          </button>
                        </div>
                        {!mailboxDateFrom[c.case_id] && !mailboxDateTo[c.case_id] && (
                          <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                            Sin fechas, busca por defecto los últimos 30 días. Se busca en Enviados y Bandeja de
                            entrada en paralelo.
                          </p>
                        )}
                        {(mailboxJobs[c.case_id] ?? []).length > 0 && (
                          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                            {(mailboxJobs[c.case_id] ?? []).map((job) => (
                              <p key={job.job_id} style={{ fontSize: 12, margin: 0 }}>
                                {MAILBOX_SEARCH_FOLDER_LABELS[job.parameters.folder as string] || job.parameters.folder}:{' '}
                                {job.status === 'queued' && 'En cola…'}
                                {job.status === 'running' && 'Buscando…'}
                                {job.status === 'success' && (
                                  <span className="badge success">{job.processed_items} indexado(s)</span>
                                )}
                                {job.status === 'failed' && <span className="badge failed">Falló: {job.error_message}</span>}
                                {job.status === 'cancelled' && <span className="badge cancelled">Cancelado</span>}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {isClosed && (
                      <p style={{ color: 'var(--warning)', fontSize: 11, marginTop: 6 }}>
                        Este expediente está cerrado — no admite cambios (correos, notas, conclusión, reanálisis).
                        Reábrelo para poder modificarlo.
                      </p>
                    )}
                    {!isClosed && isSinHallazgos && (
                      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                        Este expediente está marcado "Sin hallazgos" — no admite análisis de IA ni cierre manual
                        (ya quedó resuelto vía su conclusión).
                      </p>
                    )}
                    <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
                      "Abierto/Cerrado" es solo un marcador de si todavía se está trabajando en este expediente o ya
                      se terminó con él. Es distinto de la "Conclusión de la revisión" de abajo, que registra el
                      resultado real (con hallazgos, sin hallazgos, pendiente). Un análisis de IA exitoso cierra el
                      expediente automáticamente; si después se agrega o quita un correo, o se agrega una nota, el
                      análisis queda marcado "IA desactualizada" hasta reprocesarlo.
                    </p>

                    <div className="form-grid">
                      <div className="add-message-search">
                        <label htmlFor={`case-outcome-${c.case_id}`}>Conclusión de la revisión</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            id={`case-outcome-${c.case_id}`}
                            value={outcomeDraft[c.case_id] ?? ''}
                            onChange={(e) =>
                              setOutcomeDraft((prev) => ({ ...prev, [c.case_id]: e.target.value as CaseOutcome | '' }))
                            }
                            style={{ maxWidth: 220 }}
                            disabled={isClosed}
                          >
                            <option value="">Sin conclusión definida</option>
                            <option value="pendiente">Pendiente de revisión</option>
                            <option value="en_proceso">En proceso</option>
                            <option value="sin_hallazgos">Sin hallazgos</option>
                            <option value="con_hallazgos">Con hallazgos</option>
                            <option value="derivado">Derivado a</option>
                            <option value="mas_antecedentes">Se solicitan más antecedentes</option>
                          </select>
                          <button
                            type="button"
                            className="btn small primary icon-btn"
                            disabled={savingOutcomeId === c.case_id || isClosed}
                            onClick={() => handleSaveOutcome(c.case_id)}
                            data-tooltip={savingOutcomeId === c.case_id ? 'Guardando…' : 'Guardar conclusión'}
                            aria-label="Guardar conclusión"
                          >
                            {savingOutcomeId === c.case_id ? '…' : '💾'}
                          </button>
                        </div>
                      </div>

                      <div className="add-message-search">
                        <label>Agregar correo puntual al expediente (busca entre los correos ya indexados, por asunto)</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            placeholder="Asunto contiene..."
                            value={addMessageQuery[c.case_id] || ''}
                            onChange={(e) => setAddMessageQuery((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchMessageToAdd(c.case_id)}
                            style={{ maxWidth: 280 }}
                            disabled={isClosed}
                          />
                          <button
                            type="button"
                            className="btn small icon-btn"
                            onClick={() => handleSearchMessageToAdd(c.case_id)}
                            disabled={addMessageSearching === c.case_id || isClosed}
                            data-tooltip={addMessageSearching === c.case_id ? 'Buscando…' : 'Buscar'}
                            aria-label="Buscar"
                          >
                            {addMessageSearching === c.case_id ? '…' : '🔍'}
                          </button>
                          <button
                            type="button"
                            className="btn small icon-btn"
                            onClick={() => handleClearMessageSearch(c.case_id)}
                            disabled={!addMessageQuery[c.case_id] && !addMessageResults[c.case_id]}
                            data-tooltip="Limpiar"
                            aria-label="Limpiar"
                          >
                            ✕
                          </button>
                        </div>
                        {addMessageResults[c.case_id] && addMessageResults[c.case_id].length === 0 && (
                          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
                            Sin resultados. Solo se puede agregar un correo ya indexado — si no aparece, primero tráelo
                            con algún trabajo de búsqueda.
                          </p>
                        )}
                        {addMessageResults[c.case_id] && addMessageResults[c.case_id].length > 0 && (
                          <ul className="add-message-results">
                            {addMessageResults[c.case_id].map((m) => {
                              const alreadyLinked = detail?.messages.some((cm) => cm.message_id === m.message_id)
                              return (
                                <li key={m.message_id}>
                                  <div>
                                    <strong>{m.subject || '(sin asunto)'}</strong>
                                    <span>
                                      {m.from_name || m.from_address || '—'} · {formatDateTime(m.sent_datetime)}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn small icon-btn"
                                    disabled={alreadyLinked || addingMessageId === m.message_id || isClosed}
                                    onClick={() => handleAddMessageToCase(c.case_id, m.message_id)}
                                    data-tooltip={
                                      alreadyLinked
                                        ? 'Ya está en el expediente'
                                        : addingMessageId === m.message_id
                                          ? 'Agregando…'
                                          : 'Agregar'
                                    }
                                    aria-label="Agregar"
                                  >
                                    {addingMessageId === m.message_id ? '…' : '＋'}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="add-message-search">
                      <button
                        type="button"
                        className="btn small btn-labeled"
                        onClick={() => toggleNotes(c.case_id)}
                      >
                        {notesOpenIds.has(c.case_id) ? '📝 Ocultar notas del auditor ▾' : `📝 Notas del auditor (${detail?.notes.length ?? 0}) ▸`}
                      </button>
                      {notesOpenIds.has(c.case_id) && (
                        <>
                          <label htmlFor={`case-new-note-${c.case_id}`} style={{ marginTop: 10, display: 'block' }}>
                            Notas del auditor (texto libre, separado del resumen de IA)
                          </label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                            <textarea
                              id={`case-new-note-${c.case_id}`}
                              placeholder="Escribe una nota nueva sobre este expediente… (admite varias líneas)"
                              value={newNoteDraft[c.case_id] ?? ''}
                              onChange={(e) => setNewNoteDraft((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                              rows={3}
                              style={{ flex: 1, resize: 'vertical' }}
                              disabled={isClosed}
                            />
                            <button
                              type="button"
                              className="btn small primary icon-btn"
                              disabled={addingNoteId === c.case_id || !(newNoteDraft[c.case_id] ?? '').trim() || isClosed}
                              onClick={() => handleAddNote(c.case_id)}
                              data-tooltip={addingNoteId === c.case_id ? 'Agregando…' : 'Agregar nota'}
                              aria-label="Agregar nota"
                            >
                              {addingNoteId === c.case_id ? '…' : '💾'}
                            </button>
                          </div>
                          {detail && detail.notes.length > 0 && (
                            <div className="panel table-wrap" style={{ marginTop: 12 }}>
                            <table>
                              <thead>
                                <tr>
                                  <th style={{ width: 160 }}>Fecha</th>
                                  <th>Nota</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...detail.notes]
                                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                                  .map((note) => (
                                    <tr key={note.note_id}>
                                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                        {formatDateTime(note.created_at)}
                                      </td>
                                      <td style={{ whiteSpace: 'pre-wrap' }}>{note.body}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="add-message-search">
                      <button
                        type="button"
                        className="btn small btn-labeled"
                        onClick={() => toggleEvidence(c.case_id)}
                      >
                        {evidenceOpenIds.has(c.case_id) ? '🖼 Ocultar evidencia ▾' : `🖼 Evidencia (${detail?.evidence.length ?? 0}) ▸`}
                      </button>
                      {evidenceOpenIds.has(c.case_id) && (
                        <>
                          <label htmlFor={`case-new-evidence-glosa-${c.case_id}`} style={{ marginTop: 10, display: 'block' }}>
                            Evidencia (imágenes que respaldan el análisis — se incluyen en el PDF)
                          </label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <input
                              id={`case-new-evidence-glosa-${c.case_id}`}
                              type="text"
                              placeholder="Glosa (qué muestra esta imagen)"
                              value={newEvidenceGlosa[c.case_id] ?? ''}
                              onChange={(e) => setNewEvidenceGlosa((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                              style={{ flex: 1, minWidth: 220 }}
                              disabled={isClosed}
                            />
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp"
                              onChange={(e) =>
                                setNewEvidenceFile((prev) => ({ ...prev, [c.case_id]: e.target.files?.[0] ?? null }))
                              }
                              disabled={isClosed}
                            />
                            <button
                              type="button"
                              className="btn small primary icon-btn"
                              disabled={
                                addingEvidenceId === c.case_id ||
                                !(newEvidenceGlosa[c.case_id] ?? '').trim() ||
                                !newEvidenceFile[c.case_id] ||
                                isClosed
                              }
                              onClick={() => handleAddEvidence(c.case_id)}
                              data-tooltip={addingEvidenceId === c.case_id ? 'Agregando…' : 'Agregar evidencia'}
                              aria-label="Agregar evidencia"
                            >
                              {addingEvidenceId === c.case_id ? '…' : '💾'}
                            </button>
                          </div>
                          {detail && detail.evidence.length > 0 && (
                            <div className="panel table-wrap" style={{ marginTop: 12 }}>
                            <table>
                              <thead>
                                <tr>
                                  <th style={{ width: 160 }}>Fecha</th>
                                  <th>Glosa</th>
                                  <th style={{ width: 210 }}>Evidencia</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...detail.evidence]
                                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                                  .map((ev) => (
                                    <tr key={ev.evidence_id}>
                                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                        {formatDateTime(ev.created_at)}
                                      </td>
                                      <td>{ev.glosa}</td>
                                      <td>
                                        <a href={getCaseEvidenceUrl(c.case_id, ev.evidence_id)} target="_blank" rel="noreferrer">
                                          <img
                                            src={getCaseEvidenceUrl(c.case_id, ev.evidence_id)}
                                            alt={ev.glosa}
                                            style={{ maxWidth: 160, maxHeight: 120, borderRadius: 6, border: '1px solid var(--line)' }}
                                          />
                                        </a>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {aiResult && (
                      <div className="ai-result">
                        {editingAiSummaryId === c.case_id ? (
                          <>
                            <textarea
                              value={aiSummaryDraft}
                              onChange={(e) => setAiSummaryDraft(e.target.value)}
                              rows={5}
                              style={{ width: '100%', resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <button
                                type="button"
                                className="btn small icon-btn"
                                disabled={savingAiSummaryId === c.case_id || !aiSummaryDraft.trim()}
                                onClick={() => handleSaveAiSummary(c.case_id)}
                                data-tooltip={savingAiSummaryId === c.case_id ? 'Guardando…' : 'Guardar'}
                                aria-label="Guardar"
                              >
                                {savingAiSummaryId === c.case_id ? '…' : '💾'}
                              </button>
                              <button
                                type="button"
                                className="btn small ghost icon-btn"
                                disabled={savingAiSummaryId === c.case_id}
                                onClick={cancelEditAiSummary}
                                data-tooltip="Cancelar"
                                aria-label="Cancelar"
                              >
                                ✕
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p>{detail?.ai_summary_override || aiResult.summary}</p>
                            {detail?.ai_summary_override && (
                              <p style={{ color: 'var(--muted)', fontSize: '0.85em' }}>Editado por el auditor</p>
                            )}
                            <button
                              type="button"
                              className="btn small ghost icon-btn"
                              onClick={() => startEditAiSummary(c.case_id, detail?.ai_summary_override || aiResult.summary)}
                              data-tooltip="Editar resumen"
                              aria-label="Editar resumen"
                            >
                              ✎
                            </button>
                          </>
                        )}
                        <p>
                          <strong>Prioridad sugerida:</strong> {PRIORITY_LABELS[aiResult.suggested_priority]}
                          {' · '}
                          <strong>Próxima acción:</strong> {aiResult.suggested_next_action}
                        </p>
                        {latestAiRun?.analyzed_at && (
                          <p style={{ color: 'var(--muted)', fontSize: '0.85em' }}>
                            Analizado el {formatDateTime(latestAiRun.analyzed_at)} · {latestAiRun.provider}/{latestAiRun.model}
                          </p>
                        )}
                      </div>
                    )}
                    {!aiResult && latestAiRun && latestAiRun.status !== 'success' && (
                      <p style={{ color: 'var(--muted)', marginTop: 8 }}>
                        Último intento de análisis ({formatDateTime(latestAiRun.analyzed_at)}) terminó en "{latestAiRun.status}": {latestAiRun.error_message}
                      </p>
                    )}
                    {!detail && <p style={{ color: 'var(--muted)', marginTop: 14 }}>Cargando detalle…</p>}
                    {detail && (
                      <>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                          <button type="button" className="btn small btn-labeled" onClick={() => toggleTimeline(c.case_id)}>
                            {timelineOpenIds.has(c.case_id)
                              ? '🕒 Ocultar línea de tiempo ▾'
                              : `🕒 Mostrar línea de tiempo (${groupTimelineEvents(detail.timeline).length} evento(s)) ▸`}
                          </button>
                          <button
                            type="button"
                            className="btn small btn-labeled"
                            onClick={() =>
                              setCaseChartOpen((prev) => ({
                                ...prev,
                                [c.case_id]: prev[c.case_id] === 'timeline' ? null : 'timeline',
                              }))
                            }
                          >
                            {caseChartOpen[c.case_id] === 'timeline' ? '📊 Ocultar gráfico de actividad' : '📊 Gráfico: actividad por día'}
                          </button>
                          <button
                            type="button"
                            className="btn small btn-labeled"
                            onClick={() =>
                              setCaseChartOpen((prev) => ({
                                ...prev,
                                [c.case_id]: prev[c.case_id] === 'histogram' ? null : 'histogram',
                              }))
                            }
                          >
                            {caseChartOpen[c.case_id] === 'histogram' ? '📈 Ocultar histograma' : '📈 Gráfico: por remitente'}
                          </button>
                        </div>
                        {caseChartOpen[c.case_id] && (
                          <img
                            src={getCaseChartUrl(c.case_id, caseChartOpen[c.case_id]!)}
                            alt={caseChartOpen[c.case_id] === 'timeline' ? 'Actividad del expediente por día' : 'Correos del expediente por remitente'}
                            style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--line)', marginTop: 10 }}
                          />
                        )}
                        {timelineOpenIds.has(c.case_id) && (
                        <div className="timeline">
                          {groupTimelineEvents(detail.timeline).map(({ event, children }) => {
                            const eventMessage =
                              event.action_type === 'email_sent' && event.source_message_id
                                ? detail.messages.find((m) => m.message_id === event.source_message_id)
                                : undefined
                            return (
                            <div className={`event ${event.determination_type}`} key={event.event_id}>
                              <time>{formatDateTime(event.occurred_at)}</time>
                              <h5>
                                {event.description || event.action_type}
                                <span className="event-badge">{DETERMINATION_LABELS[event.determination_type]}</span>
                              </h5>
                              <p>{event.actor && `De: ${event.actor}`}</p>
                              {eventMessage && (eventMessage.body_content || eventMessage.body_preview) && (
                                <div style={{ marginTop: 6 }}>
                                  <button
                                    type="button"
                                    className="btn small icon-btn"
                                    onClick={() => openBodyModal(eventMessage)}
                                    data-tooltip="Ver cuerpo"
                                    aria-label="Ver cuerpo"
                                  >
                                    👁
                                  </button>
                                  {eventMessage.web_link && (
                                    <a
                                      href={eventMessage.web_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="btn small icon-btn"
                                      style={{ marginLeft: 6 }}
                                      data-tooltip="Ver correo"
                                      aria-label="Ver correo"
                                    >
                                      🔗
                                    </a>
                                  )}
                                </div>
                              )}
                              {eventMessage && eventMessage.has_attachments && eventMessage.attachments.length === 0 && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                                  <span style={{ color: 'var(--muted)' }}>Adjunto no trazado</span>
                                  <button
                                    type="button"
                                    className="btn small icon-btn"
                                    disabled={retracingMessageId === eventMessage.message_id}
                                    onClick={() => handleRetraceAttachments(c.case_id, eventMessage.message_id)}
                                    data-tooltip={retracingMessageId === eventMessage.message_id ? 'Recuperando…' : 'Recuperar adjuntos'}
                                    aria-label="Recuperar adjuntos"
                                  >
                                    {retracingMessageId === eventMessage.message_id ? '…' : '📎'}
                                  </button>
                                </div>
                              )}
                              {children.length > 0 && (
                                <ul className="event-attachments">
                                  {children.map((child) => {
                                    const childAttachment = eventMessage?.attachments.find(
                                      (a) => a.attachment_row_id === child.source_attachment_id,
                                    )
                                    return (
                                      <li key={child.event_id}>
                                        {childAttachment && eventMessage ? (
                                          <AttachmentItem
                                            messageId={eventMessage.message_id}
                                            attachmentId={childAttachment.attachment_id}
                                            fileName={childAttachment.file_name}
                                            extension={childAttachment.extension}
                                            sizeBytes={childAttachment.size_bytes}
                                            matchesNamingConvention={childAttachment.matches_naming_convention}
                                            matchesSearchPattern={childAttachment.matches_search_pattern}
                                            contentSha256={childAttachment.content_sha256}
                                          />
                                        ) : (
                                          <span>📎 {stripCorreoSuffix(child.description)}</span>
                                        )}
                                        {child.determination_type !== 'validacion_manual' && (
                                          <button
                                            type="button"
                                            className="btn small icon-btn"
                                            disabled={isClosed}
                                            onClick={() => validateEvent(c.case_id, child.event_id)}
                                            data-tooltip="Validar"
                                            aria-label="Validar"
                                          >
                                            ✓
                                          </button>
                                        )}
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                              {event.determination_type !== 'validacion_manual' && (
                                <div className="event-actions">
                                  <button
                                    type="button"
                                    className="btn small icon-btn"
                                    disabled={isClosed}
                                    onClick={() => validateEvent(c.case_id, event.event_id)}
                                    data-tooltip="Marcar como validado manualmente"
                                    aria-label="Marcar como validado manualmente"
                                  >
                                    ✓
                                  </button>
                                </div>
                              )}
                            </div>
                            )
                          })}
                        </div>
                        )}
                        <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 16, marginBottom: 4 }}>
                          Confianza: <strong>100%</strong> = mismo hilo de conversación o agregado a mano ·{' '}
                          <strong>70%</strong> = coincidencia por palabra clave/código ·{' '}
                          <strong>40%</strong> = heurística (mismo tema + participante en común, dentro de 30 días).
                        </p>
                        <div className="table-wrap">
                        <table className="table-wide">
                          <thead>
                            <tr>
                              <th>Buzón</th>
                              <th>Asunto</th>
                              <th>De</th>
                              <th>Enviado</th>
                              <th title="100% = mismo hilo o manual · 70% = palabra clave · 40% = heurística">
                                Confianza
                              </th>
                              <th>Adjuntos</th>
                              <th>Contenido</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.messages.map((m) => {
                              return (
                                <Fragment key={m.message_id}>
                                  <tr>
                                    <td>{m.mailbox_label || <span style={{ color: 'var(--muted)' }}>sin etiquetar</span>}</td>
                                    <td>{m.subject || '(sin asunto)'}</td>
                                    <td>{m.from_address || '—'}</td>
                                    <td>{formatDateTime(m.sent_datetime)}</td>
                                    <td>{(m.confidence * 100).toFixed(0)}%</td>
                                    <td>
                                      {!m.has_attachments && <span style={{ color: 'var(--muted)' }}>Sin adjunto</span>}
                                      {m.has_attachments && m.attachments.length === 0 && (
                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                          <span style={{ color: 'var(--muted)' }}>Adjunto no trazado</span>
                                          <button
                                            type="button"
                                            className="btn small icon-btn"
                                            disabled={retracingMessageId === m.message_id}
                                            onClick={() => handleRetraceAttachments(c.case_id, m.message_id)}
                                            data-tooltip={retracingMessageId === m.message_id ? 'Recuperando…' : 'Recuperar adjuntos'}
                                            aria-label="Recuperar adjuntos"
                                          >
                                            {retracingMessageId === m.message_id ? '…' : '📎'}
                                          </button>
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
                                        {(m.body_content || m.body_preview) ? (
                                          <button
                                            type="button"
                                            className="btn small icon-btn"
                                            onClick={() => openBodyModal(m)}
                                            data-tooltip="Ver cuerpo"
                                            aria-label="Ver cuerpo"
                                          >
                                            👁
                                          </button>
                                        ) : (
                                          <span style={{ color: 'var(--muted)' }}>Sin contenido</span>
                                        )}
                                        {m.web_link && (
                                          <a
                                            href={m.web_link}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="btn small icon-btn"
                                            data-tooltip="Ver correo"
                                            aria-label="Ver correo"
                                          >
                                            🔗
                                          </a>
                                        )}
                                        <button
                                          type="button"
                                          className="btn small danger icon-btn"
                                          disabled={isClosed}
                                          onClick={() =>
                                            setRemoveMessageTarget({
                                              caseId: c.case_id,
                                              messageId: m.message_id,
                                              subject: m.subject || '(sin asunto)',
                                            })
                                          }
                                          data-tooltip="Quitar"
                                          aria-label="Quitar"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>

      <ConfirmModal
        open={clearModalOpen}
        title="Limpiar expedientes"
        description="Esta acción elimina los expedientes seleccionados, sus mensajes correlacionados y su línea de tiempo. Los correos indexados y los adjuntos originales permanecen disponibles para futuros análisis."
        confirmLabel="Confirmar limpieza"
        confirming={clearing}
        onCancel={() => setClearModalOpen(false)}
        onConfirm={handleClear}
      >
        <div className="danger-zone">
          <label htmlFor="clearCasesScope">Alcance de la limpieza</label>
          <select
            id="clearCasesScope"
            value={clearScope}
            onChange={(e) => setClearScope(e.target.value as typeof clearScope)}
          >
            <option value="all">Todos los expedientes</option>
            <option value="open">Solo expedientes abiertos</option>
            <option value="closed">Solo expedientes cerrados</option>
          </select>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={aiConfirmOpen}
        title="Procesar todo con IA"
        description="Esta acción ejecuta el análisis de IA sobre todos los expedientes que todavía no tienen un análisis exitoso. El expediente no se cierra automáticamente — el resumen queda disponible para revisión y edición del auditor. Dependiendo de la cantidad de expedientes puede tardar varios minutos."
        confirmLabel="Procesar con IA"
        confirmIcon="🤖"
        confirmDanger={false}
        onCancel={() => setAiConfirmOpen(false)}
        onConfirm={handleConfirmProcessAllWithAI}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title="Eliminar expediente"
        description={
          deleteTarget
            ? `Esta acción elimina el expediente "${deleteTarget.title}", sus mensajes correlacionados y su línea de tiempo. Los correos indexados y los adjuntos originales permanecen disponibles para futuros análisis.`
            : ''
        }
        confirmLabel="Eliminar expediente"
        confirming={deletingCase}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteCase}
      />

      <ShareModal
        open={shareCaseTarget !== null}
        title={shareCaseTarget ? `Compartir "${shareCaseTarget.title}"` : 'Compartir expediente'}
        description="Elige con quién compartir este expediente y con qué permiso."
        allowEditPermission
        existingShares={caseShares}
        sharing={sharingCase}
        revokingUserId={revokingCaseShareUserId}
        onShare={handleShareCaseConfirm}
        onRevoke={handleRevokeCaseShare}
        onClose={() => setShareCaseTarget(null)}
      />

      <ConfirmModal
        open={removeMessageTarget !== null}
        title="Quitar correo del expediente"
        description={
          removeMessageTarget
            ? `Se desvincula "${removeMessageTarget.subject}" de este expediente y su evento de la línea de tiempo. El correo sigue disponible en el índice general — esto no lo borra, solo lo desvincula de este caso.`
            : ''
        }
        confirmLabel="Quitar correo"
        confirmIcon="✕"
        confirming={removingMessage}
        onCancel={() => setRemoveMessageTarget(null)}
        onConfirm={handleRemoveMessage}
      />

      <MessageBodyModal state={bodyModal} onClose={() => setBodyModal(null)} />

      <div
        className={`modal-backdrop${sendEmailTarget !== null ? ' open' : ''}`}
      >
        <div className="modal medium">
          <div className="modal-body">
            <h3>Enviar correo</h3>
            <p>
              Se prellena con los involucrados del último correo del expediente. El PDF del expediente se adjunta
              automáticamente si se deja marcada la casilla.
            </p>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field full">
                <label htmlFor="sendEmailTo">Para</label>
                <input
                  id="sendEmailTo"
                  type="text"
                  value={sendEmailForm.to}
                  onChange={(e) => setSendEmailForm((prev) => ({ ...prev, to: e.target.value }))}
                  placeholder="correo1@dominio.cl; correo2@dominio.cl"
                />
              </div>
              <div className="field full">
                <label htmlFor="sendEmailCc">Con copia (CC)</label>
                <input
                  id="sendEmailCc"
                  type="text"
                  value={sendEmailForm.cc}
                  onChange={(e) => setSendEmailForm((prev) => ({ ...prev, cc: e.target.value }))}
                  placeholder="correo1@dominio.cl; correo2@dominio.cl"
                />
              </div>
              <div className="field full">
                <label htmlFor="sendEmailSubject">Asunto</label>
                <input
                  id="sendEmailSubject"
                  type="text"
                  value={sendEmailForm.subject}
                  onChange={(e) => setSendEmailForm((prev) => ({ ...prev, subject: e.target.value }))}
                />
              </div>
              <div className="field full">
                <label htmlFor="sendEmailBody">Cuerpo</label>
                <textarea
                  id="sendEmailBody"
                  rows={8}
                  value={sendEmailForm.body}
                  onChange={(e) => setSendEmailForm((prev) => ({ ...prev, body: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="sendEmailMailbox">Enviar desde</label>
                <select
                  id="sendEmailMailbox"
                  value={sendEmailForm.mailboxAccountId ?? ''}
                  onChange={(e) =>
                    setSendEmailForm((prev) => ({ ...prev, mailboxAccountId: e.target.value ? Number(e.target.value) : null }))
                  }
                >
                  <option value="">Selecciona un buzón</option>
                  {mailboxAccounts
                    .filter((m) => m.enabled)
                    .map((m) => (
                      <option key={m.mailbox_account_id} value={m.mailbox_account_id}>
                        {m.label} ({m.email_address})
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sendEmailAttachments">Adjuntos adicionales</label>
                <input
                  id="sendEmailAttachments"
                  type="file"
                  multiple
                  onChange={(e) =>
                    setSendEmailForm((prev) => ({ ...prev, files: e.target.files ? Array.from(e.target.files) : [] }))
                  }
                />
              </div>
              <div className="field full">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={sendEmailForm.attachPdf}
                    onChange={(e) => setSendEmailForm((prev) => ({ ...prev, attachPdf: e.target.checked }))}
                  />
                  Adjuntar PDF del expediente
                </label>
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn small btn-labeled" disabled={sendingEmail} onClick={closeSendEmailModal}>
              ✕ Cancelar
            </button>
            <button type="button" className="btn small primary btn-labeled" disabled={sendingEmail} onClick={handleSendEmail}>
              {sendingEmail ? 'Enviando…' : '✉ Enviar'}
            </button>
          </div>
        </div>
      </div>

    </section>
  )
}
