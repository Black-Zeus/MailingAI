import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
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
  getCaseAuditLog,
  getCaseEvidenceUrl,
  getJob,
  getLatestAIBatchAnalyze,
  getLatestCaseBatchCreate,
  getCaseChartUrl,
  listCases,
  mergeCases,
  listJobs,
  listMailboxes,
  listMessages,
  refreshCase,
  refreshOpenCases,
  listCaseShares,
  reassignCaseOwner,
  removeCaseMessage,
  renderMarkdownPreview,
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
import type { CaseAuditLogRead, CaseBatchRunRead, CaseDetail, CaseOutcome, CaseSeedPrefill, CaseShareRead, CaseSummary, CaseType, SeedType } from '../types/cases'
import type { JobRead } from '../types/jobs'
import type { MessageListItem } from '../types/messages'
import { CASE_OUTCOME_LABELS, DETERMINATION_LABELS } from '../types/cases'
import type { AIBatchRunRead } from '../types/ai'
import type { MailboxAccountRead } from '../types/mailboxes'
import { KpiCard } from '../components/KpiCard'
import { PRIORITY_LABELS } from '../types/ai'
import { ConfirmModal } from '../components/ConfirmModal'
import { ShareModal, type PendingShareChanges } from '../components/ShareModal'
import { AskCaseModal } from '../components/AskCaseModal'
import { AttachmentItem } from '../components/AttachmentItem'
import { MessageBodyModal, MessageBodyView, type MessageBodyModalState } from '../components/MessageBodyModal'
import { ActionButton } from '../components/ActionButton'
import { MarkdownHelpModal } from '../components/MarkdownHelpModal'
import { ReassignOwnerModal } from '../components/ReassignOwnerModal'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Eye,
  ExternalLink,
  FileDown,
  HelpCircle,
  Inbox,
  UserCog,
  Lock,
  Mail,
  MessageCircleQuestion,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Search,
  Share2,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDateTime, groupTimelineEvents, stripCorreoSuffix } from '../utils/timeline'
import { toEndOfDayISO, toStartOfDayISO } from '../utils/dates'
import { useModalBehavior } from '../utils/modalScrollLock'

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
  openCaseId?: number | null
  onOpenCaseIdConsumed?: () => void
}

export function CasesView({ prefill, onPrefillConsumed, openCaseId, onOpenCaseIdConsumed }: CasesViewProps) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [shareCaseTarget, setShareCaseTarget] = useState<CaseSummary | null>(null)
  const [caseShares, setCaseShares] = useState<CaseShareRead[]>([])
  const [sharingCase, setSharingCase] = useState(false)
  const [reassignOwnerTarget, setReassignOwnerTarget] = useState<CaseSummary | null>(null)
  const [reassigningOwner, setReassigningOwner] = useState(false)
  const [conflictModal, setConflictModal] = useState<{ caseId: number; message: string } | null>(null)
  const [reloadingConflictedCase, setReloadingConflictedCase] = useState(false)

  async function openShareCaseModal(c: CaseSummary) {
    setShareCaseTarget(c)
    try {
      setCaseShares(await listCaseShares(c.case_id))
    } catch (err) {
      setCaseShares([])
      showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar las comparticiones.', true)
    }
  }

  async function handleConfirmCaseShares(changes: PendingShareChanges) {
    if (!shareCaseTarget) return
    setSharingCase(true)
    let failCount = 0
    for (const add of changes.adds) {
      try {
        await shareCase(shareCaseTarget.case_id, add.userId, add.permission)
      } catch {
        failCount += 1
      }
    }
    for (const userId of changes.removeUserIds) {
      try {
        await revokeCaseShare(shareCaseTarget.case_id, userId)
      } catch {
        failCount += 1
      }
    }
    setCaseShares(await listCaseShares(shareCaseTarget.case_id))
    setSharingCase(false)
    if (failCount === 0) {
      showToast('Cambios guardados.')
      setShareCaseTarget(null)
    } else {
      showToast(`${failCount} cambio(s) no se pudieron aplicar — revisa la lista e intenta de nuevo.`, true)
    }
  }

  async function handleReloadConflictedCase() {
    if (!conflictModal) return
    const { caseId } = conflictModal
    setReloadingConflictedCase(true)
    try {
      const fresh = await getCase(caseId)
      setDetails((prev) => ({ ...prev, [caseId]: fresh }))
      await refreshCases()
      setConflictModal(null)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo recargar el expediente.', true)
    } finally {
      setReloadingConflictedCase(false)
    }
  }

  async function handleReassignOwnerConfirm(newOwnerUserId: number) {
    if (!reassignOwnerTarget) return
    setReassigningOwner(true)
    try {
      const updated = await reassignCaseOwner(reassignOwnerTarget.case_id, newOwnerUserId)
      setDetails((prev) => ({ ...prev, [reassignOwnerTarget.case_id]: updated }))
      await refreshCases()
      showToast('Dueño del expediente reasignado.')
      setReassignOwnerTarget(null)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo reasignar el expediente.', true)
    } finally {
      setReassigningOwner(false)
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
  const [askCaseTarget, setAskCaseTarget] = useState<CaseSummary | null>(null)
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
  const aiAnalysisPollRefs = useRef<Record<number, number>>({})
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
  const [auditLogOpenIds, setAuditLogOpenIds] = useState<Set<number>>(new Set())
  const [auditLogs, setAuditLogs] = useState<Record<number, CaseAuditLogRead[]>>({})
  const [loadingAuditLogId, setLoadingAuditLogId] = useState<number | null>(null)
  const [outcomeDraft, setOutcomeDraft] = useState<Record<number, CaseOutcome | ''>>({})
  const [pendingActionDraft, setPendingActionDraft] = useState<Record<number, string>>({})
  const [nextReviewDraft, setNextReviewDraft] = useState<Record<number, string>>({})
  const [savingOutcomeId, setSavingOutcomeId] = useState<number | null>(null)
  const [savingFollowUpId, setSavingFollowUpId] = useState<number | null>(null)
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
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false)
  const [mdHelpOpen, setMdHelpOpen] = useState(false)
  const [emailPreviewHtml, setEmailPreviewHtml] = useState('')
  const [loadingEmailPreview, setLoadingEmailPreview] = useState(false)

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

  async function toggleAuditLog(caseId: number) {
    const willOpen = !auditLogOpenIds.has(caseId)
    setAuditLogOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else {
        next.add(caseId)
      }
      return next
    })
    if (willOpen && !auditLogs[caseId]) {
      setLoadingAuditLogId(caseId)
      try {
        const entries = await getCaseAuditLog(caseId)
        setAuditLogs((prev) => ({ ...prev, [caseId]: entries }))
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'No se pudo cargar el historial de auditoría.', true)
      } finally {
        setLoadingAuditLogId(null)
      }
    }
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

  const [searchText, setSearchText] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'closed'>('all')
  const [filterOutcome, setFilterOutcome] = useState<'all' | CaseOutcome>('all')
  const [filterCaseType, setFilterCaseType] = useState<'all' | CaseType>('all')
  const [sortBy, setSortBy] = useState<'created_at' | 'title' | 'message_count' | 'last_message_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<number>>(new Set())
  const [mergeModalOpen, setMergeModalOpen] = useState(false)
  const [mergeTitle, setMergeTitle] = useState('')
  const [merging, setMerging] = useState(false)

  useModalBehavior(bulkOpen || formOpen || sendEmailTarget !== null || mergeModalOpen)

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

  useEffect(() => {
    if (openCaseId == null || !cases) return
    clearCaseFilters()
    setOpenCaseIds((prev) => new Set(prev).add(openCaseId))
    if (!details[openCaseId]) {
      getCase(openCaseId)
        .then((detail) => {
          setDetails((prev) => ({ ...prev, [openCaseId]: detail }))
          setOutcomeDraft((prev) => ({ ...prev, [openCaseId]: detail.outcome ?? '' }))
          setPendingActionDraft((prev) => ({ ...prev, [openCaseId]: detail.pending_action ?? '' }))
          setNextReviewDraft((prev) => ({ ...prev, [openCaseId]: detail.next_review_at ?? '' }))
        })
        .catch(() => {})
    }
    window.setTimeout(() => {
      document.getElementById(`case-card-${openCaseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    onOpenCaseIdConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCaseId, cases])

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
      Object.values(aiAnalysisPollRefs.current).forEach((handle) => window.clearInterval(handle))
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
        setPendingActionDraft((prev) => ({ ...prev, [caseId]: detail.pending_action ?? '' }))
        setNextReviewDraft((prev) => ({ ...prev, [caseId]: detail.next_review_at ?? '' }))
        if (detail.latest_ai_run?.status === 'running') {
          // Retoma el polling si el analisis de IA quedo corriendo de una
          // visita anterior -- el estado vive en el backend (mailing.ai_runs),
          // no se pierde al navegar a otra pantalla y volver.
          startAiAnalysisPoll(caseId)
        }
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
      const updated = await updateCase(caseId, {
        outcome: outcomeDraft[caseId] || null,
        expected_updated_at: details[caseId]?.updated_at,
      })
      setDetails((prev) => ({ ...prev, [caseId]: updated }))
      await refreshCases()
      showToast('Conclusión del expediente guardada')
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setConflictModal({ caseId, message: err.message })
      } else {
        showToast(err instanceof ApiError ? err.message : 'No se pudo guardar la conclusión.', true)
      }
    } finally {
      setSavingOutcomeId(null)
    }
  }

  async function handleSaveFollowUp(caseId: number) {
    setSavingFollowUpId(caseId)
    try {
      const updated = await updateCase(caseId, {
        pending_action: pendingActionDraft[caseId]?.trim() || null,
        next_review_at: nextReviewDraft[caseId] || null,
        expected_updated_at: details[caseId]?.updated_at,
      })
      setDetails((prev) => ({ ...prev, [caseId]: updated }))
      showToast('Seguimiento del expediente guardado')
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setConflictModal({ caseId, message: err.message })
      } else {
        showToast(err instanceof ApiError ? err.message : 'No se pudo guardar el seguimiento.', true)
      }
    } finally {
      setSavingFollowUpId(null)
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
      if (result.status === 'running') {
        // La llamada al proveedor de IA sigue corriendo en el backend --
        // se empieza a consultar el estado real en vez de dar el analisis
        // por terminado aca (ver startAiAnalysisPoll).
        startAiAnalysisPoll(caseId)
        return
      }
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
      const detail = await updateAiSummary(caseId, trimmed, details[caseId]?.updated_at)
      setDetails((prev) => ({ ...prev, [caseId]: detail }))
      setEditingAiSummaryId(null)
      showToast('Resumen de IA actualizado')
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setConflictModal({ caseId, message: err.message })
      } else {
        showToast(err instanceof ApiError ? err.message : 'No se pudo actualizar el resumen.', true)
      }
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
    // Precarga el cuerpo con la ultima nota del auditor, en Markdown (mas
    // simple de leer/editar que HTML crudo) -- se convierte a HTML recien al
    // enviar o al pedir la vista previa (ver handleSendEmail / handlePreviewEmail).
    const latestNote = detail?.notes.length
      ? [...detail.notes].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      : null
    setSendEmailForm({
      to: Array.from(toSet).join('; '),
      cc: Array.from(ccSet).join('; '),
      subject: lastMessage?.subject ? `RE: ${lastMessage.subject}` : `Expediente ${detail?.title ?? ''}`,
      body: latestNote?.body_markdown ?? '',
      mailboxAccountId: defaultMailboxId,
      attachPdf: true,
      files: [],
    })
    setSendEmailTarget(caseId)
  }

  function closeSendEmailModal() {
    setSendEmailTarget(null)
    setEmailPreviewOpen(false)
  }

  async function handlePreviewEmail() {
    setLoadingEmailPreview(true)
    try {
      const { html } = await renderMarkdownPreview(sendEmailForm.body)
      setEmailPreviewHtml(html)
      setEmailPreviewOpen(true)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo generar la vista previa.', true)
    } finally {
      setLoadingEmailPreview(false)
    }
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

  function stopAiAnalysisPoll(caseId: number) {
    const handle = aiAnalysisPollRefs.current[caseId]
    if (handle !== undefined) {
      window.clearInterval(handle)
      delete aiAnalysisPollRefs.current[caseId]
    }
  }

  function startAiAnalysisPoll(caseId: number) {
    stopAiAnalysisPoll(caseId)
    const poll = async () => {
      try {
        const detail = await getCase(caseId)
        setDetails((prev) => ({ ...prev, [caseId]: detail }))
        if (detail.latest_ai_run?.status !== 'running') {
          stopAiAnalysisPoll(caseId)
          if (detail.latest_ai_run?.status === 'success') {
            showToast('Análisis de IA completado')
          } else if (detail.latest_ai_run) {
            showToast(
              detail.latest_ai_run.error_message || `El análisis terminó en estado "${detail.latest_ai_run.status}".`,
              true,
            )
          }
        }
      } catch {
        // se reintenta en el siguiente tick
      }
    }
    poll()
    aiAnalysisPollRefs.current[caseId] = window.setInterval(poll, 4000)
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

  function toggleCaseSelected(caseId: number, e: MouseEvent) {
    e.stopPropagation()
    setSelectedCaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) next.delete(caseId)
      else next.add(caseId)
      return next
    })
  }

  function openMergeModal() {
    setMergeTitle('')
    setMergeModalOpen(true)
  }

  async function handleConfirmMerge() {
    const title = mergeTitle.trim()
    if (!title || selectedCaseIds.size < 2) return
    setMerging(true)
    try {
      const merged = await mergeCases([...selectedCaseIds], title)
      showToast(`Expedientes fusionados en "${merged.title}" (#${merged.case_id}).`)
      setMergeModalOpen(false)
      setSelectedCaseIds(new Set())
      await refreshCases()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo fusionar los expedientes.', true)
    } finally {
      setMerging(false)
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

  const filtersActive =
    searchText.trim() !== '' || filterStatus !== 'all' || filterOutcome !== 'all' || filterCaseType !== 'all'

  const visibleCases = useMemo(() => {
    if (!cases) return null
    const text = searchText.trim().toLowerCase()
    const filtered = cases.filter((c) => {
      if (filterStatus !== 'all' && c.status !== filterStatus) return false
      if (filterOutcome !== 'all' && c.outcome !== filterOutcome) return false
      if (filterCaseType !== 'all' && c.case_type !== filterCaseType) return false
      if (text) {
        const haystack = `${c.title} ${c.external_code ?? ''}`.toLowerCase()
        if (!haystack.includes(text)) return false
      }
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title) * dir
        case 'message_count':
          return (a.message_count - b.message_count) * dir
        case 'last_message_at':
          return (
            (a.last_message_at ? new Date(a.last_message_at).getTime() : 0) -
            (b.last_message_at ? new Date(b.last_message_at).getTime() : 0)
          ) * dir
        case 'created_at':
        default:
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
      }
    })
  }, [cases, searchText, filterStatus, filterOutcome, filterCaseType, sortBy, sortDir])

  // Mismo criterio que usa el backend para elegir que expedientes entran al
  // lote (mailing.cases sin un ai_runs exitoso) -- se calcula aca para poder
  // avisar ANTES de lanzarlo si hay cerrados en el medio (el analisis de IA
  // no corre sobre expedientes cerrados, quedarian contados como "fallidos"
  // sin ser un error real).
  const aiPendingCounts = useMemo(() => {
    const pending = (cases ?? []).filter((c) => !c.has_successful_ai_run)
    const closed = pending.filter((c) => c.status === 'closed').length
    return { total: pending.length, closed, open: pending.length - closed }
  }, [cases])

  function clearCaseFilters() {
    setSearchText('')
    setFilterStatus('all')
    setFilterOutcome('all')
    setFilterCaseType('all')
  }

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
          {isAdmin && (
            <button
              type="button"
              className="btn btn-labeled"
              onClick={() => setAiConfirmOpen(true)}
              disabled={(activeAiBatch !== null && activeAiBatch.status !== 'success' && activeAiBatch.status !== 'failed') || cases === null}
              title="Analiza todos los expedientes del sistema que aún no tienen un análisis exitoso — no solo los tuyos"
            >
              {activeAiBatch && (activeAiBatch.status === 'queued' || activeAiBatch.status === 'running')
                ? `Procesando con IA… (${activeAiBatch.processed_cases}/${activeAiBatch.total_cases})`
                : '🤖 Procesar todo con IA'}
            </button>
          )}
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
          {selectedCaseIds.size >= 2 && (
            <button type="button" className="btn primary btn-labeled" onClick={openMergeModal}>
              ⛙ Fusionar ({selectedCaseIds.size})
            </button>
          )}
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
        <KpiCard label="Expedientes" value={total} />
        <KpiCard label="Abiertos" value={open} color="var(--warning)" />
        <KpiCard label="Cerrados" value={closed} color="var(--success)" />
        <KpiCard label="Mensajes correlacionados" value={totalMessages} color="var(--accent-2)" />
      </div>

      <div
        className={`modal-backdrop${bulkOpen ? ' open' : ''}`}
      >
        <div className="modal medium">
          <div className="modal-body">
            <h3>Crear expedientes en lote</h3>
            <p>Un código/palabra clave por línea</p>
            <div className="form-grid mt-6">
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
                        <th scope="col">Código</th>
                        <th scope="col">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeCaseBatch.items.map((p) => (
                        <tr key={p.item_id}>
                          <td className="mono">{p.keyword}</td>
                          <td>
                            {p.status === 'pendiente' && <span className="text-muted">Pendiente</span>}
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
              <div className="form-grid mt-6">
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

      <div className="toolbar">
        <input
          type="text"
          placeholder="Buscar por título o código..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
          <option value="all">Cualquier estado</option>
          <option value="open">Abierto</option>
          <option value="closed">Cerrado</option>
        </select>
        <select value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value as typeof filterOutcome)}>
          <option value="all">Cualquier resultado</option>
          {(Object.keys(CASE_OUTCOME_LABELS) as CaseOutcome[]).map((o) => (
            <option key={o} value={o}>
              {CASE_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
        <select value={filterCaseType} onChange={(e) => setFilterCaseType(e.target.value as typeof filterCaseType)}>
          <option value="all">Cualquier tipo</option>
          <option value="conversation">Conversación</option>
          <option value="cr">CR</option>
          <option value="custom">Manual</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="created_at">Ordenar por fecha de creación</option>
          <option value="title">Ordenar por nombre</option>
          <option value="last_message_at">Ordenar por última actividad</option>
          <option value="message_count">Ordenar por cantidad de mensajes</option>
        </select>
        <ActionButton
          icon={sortDir === 'asc' ? ArrowUp : ArrowDown}
          label={sortDir === 'asc' ? 'Ascendente' : 'Descendente'}
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        />
        {filtersActive && (
          <button type="button" className="btn small btn-labeled" onClick={clearCaseFilters}>
            ✕ Limpiar filtros
          </button>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Resultados</h3>
          <span>
            {filtersActive
              ? `${visibleCases?.length ?? 0} de ${total} expediente(s)`
              : `${total} ${total === 1 ? 'expediente' : 'expedientes'}`}
          </span>
        </div>
        <div className="panel-body case-list">
          {cases !== null && cases.length === 0 && (
            <div className="empty-view">
              <strong>No existen expedientes almacenados.</strong>
              <p>Crea uno nuevo a partir de un hilo, un código CR, o un mensaje puntual.</p>
            </div>
          )}
          {cases !== null && cases.length > 0 && visibleCases?.length === 0 && (
            <div className="empty-view">
              <strong>Ningún expediente coincide con los filtros.</strong>
              <p>Probá ajustar la búsqueda o limpiar los filtros.</p>
            </div>
          )}
          {visibleCases?.map((c) => {
            const isOpen = openCaseIds.has(c.case_id)
            const detail = details[c.case_id]
            const latestAiRun = detail?.latest_ai_run
            const aiResult = latestAiRun?.result
            const isClosed = c.status === 'closed'
            const isSinHallazgos = c.outcome === 'sin_hallazgos'
            const aiRunning = analyzingId === c.case_id || latestAiRun?.status === 'running'
            return (
              <article id={`case-card-${c.case_id}`} className={`case-card${isOpen ? ' open' : ''}`} key={c.case_id}>
                <div
                  className="case-summary"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleCase(c.case_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleCase(c.case_id)
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={selectedCaseIds.has(c.case_id)}
                      onClick={(e) => toggleCaseSelected(c.case_id, e)}
                      onChange={() => {}}
                      style={{ marginTop: 4 }}
                      aria-label={`Seleccionar expediente ${c.title}`}
                    />
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
                            : c.outcome === 'sin_hallazgos' || c.outcome === 'investigado_sin_compromiso'
                              ? 'success'
                              : c.outcome === 'derivado' || c.outcome === 'mas_antecedentes'
                                ? 'queued'
                                : c.outcome === 'en_proceso' || c.outcome === 'mitigado'
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
                    {c.previous_owner_label && (
                      <span className="badge queued" title="Reasignado automáticamente al eliminarse la cuenta del dueño original">
                        Antes de: {c.previous_owner_label}
                      </span>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="case-detail">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <ActionButton
                        icon={Search}
                        label={refreshingId === c.case_id ? 'Buscando correos relacionados…' : 'Buscar correos relacionados'}
                        loading={refreshingId === c.case_id}
                        disabled={isClosed}
                        onClick={() => handleRefreshCorrelation(c.case_id)}
                      />
                      <ActionButton
                        icon={Inbox}
                        label={mailboxSearchOpenIds.has(c.case_id) ? 'Cerrar búsqueda en el buzón' : 'Buscar en el buzón (Graph)'}
                        variant={mailboxSearchOpenIds.has(c.case_id) ? 'active' : 'default'}
                        disabled={isClosed}
                        onClick={() => toggleMailboxSearch(c.case_id, c.external_code)}
                      />
                      <ActionButton
                        icon={Bot}
                        label={aiRunning ? 'Procesando con IA…' : 'Analizar con IA'}
                        loading={aiRunning}
                        disabled={isClosed}
                        onClick={() => handleAnalyze(c.case_id)}
                      />
                      <ActionButton
                        icon={MessageCircleQuestion}
                        label="Consultar expediente"
                        onClick={() => setAskCaseTarget(c)}
                      />
                      <ActionButton
                        icon={FileDown}
                        label={exportingCaseId === c.case_id ? 'Generando PDF…' : 'Exportar expediente (PDF)'}
                        loading={exportingCaseId === c.case_id}
                        onClick={() => handleExportCase(c.case_id, c.title)}
                      />
                      <ActionButton
                        icon={Mail}
                        label="Enviar correo"
                        disabled={!detail || detail.messages.length === 0}
                        onClick={() => openSendEmailModal(c.case_id)}
                      />
                      <ActionButton
                        icon={c.status === 'open' ? Lock : Unlock}
                        label={
                          togglingStatusId === c.case_id
                            ? 'Guardando…'
                            : c.status === 'open'
                              ? 'Cerrar expediente'
                              : 'Reabrir expediente'
                        }
                        loading={togglingStatusId === c.case_id}
                        onClick={() => handleToggleStatus(c.case_id, c.status === 'open' ? 'closed' : 'open')}
                      />
                      {(isAdmin || c.owner_user_id === user?.user_id) && (
                        <ActionButton icon={Share2} label="Compartir" onClick={() => openShareCaseModal(c)} />
                      )}
                      {isAdmin && (
                        <ActionButton
                          icon={UserCog}
                          label="Reasignar dueño"
                          onClick={() => setReassignOwnerTarget(c)}
                        />
                      )}
                      <ActionButton
                        icon={Trash2}
                        label="Eliminar expediente"
                        variant="danger"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => setDeleteTarget(c)}
                      />
                    </div>
                    {mailboxSearchOpenIds.has(c.case_id) && (
                      <div className="add-message-search mt-4">
                        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 8px' }}>
                          "Buscar correos relacionados" solo busca dentro de lo ya indexado localmente — esto en
                          cambio trae correos nuevos desde el buzón real (Graph) que contengan el texto en asunto o
                          cuerpo, los indexa, y automáticamente vuelve a correlacionar el expediente.
                        </p>
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
                          <ActionButton
                            icon={Search}
                            label="Buscar"
                            variant="primary"
                            disabled={
                              !(mailboxQuery[c.case_id] ?? '').trim() ||
                              !mailboxSearchAccountId[c.case_id] ||
                              (mailboxJobs[c.case_id] ?? []).some((j) => j.status === 'queued' || j.status === 'running')
                            }
                            onClick={() => handleSearchMailbox(c.case_id)}
                          />
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
                            <option value="sin_hallazgos">Sin hallazgos (nada que revisar)</option>
                            <option value="investigado_sin_compromiso">Investigado — sin compromiso</option>
                            <option value="falso_positivo">Falso positivo</option>
                            <option value="con_hallazgos">Con hallazgos</option>
                            <option value="mitigado">Mitigado / remediado</option>
                            <option value="derivado">Derivado a</option>
                            <option value="mas_antecedentes">Se solicitan más antecedentes</option>
                            <option value="sin_recepcion">Sin recepción del correo</option>
                          </select>
                          <ActionButton
                            icon={Save}
                            label={savingOutcomeId === c.case_id ? 'Guardando…' : 'Guardar conclusión'}
                            variant="primary"
                            loading={savingOutcomeId === c.case_id}
                            disabled={isClosed}
                            onClick={() => handleSaveOutcome(c.case_id)}
                          />
                        </div>
                      </div>

                      <div className="add-message-search">
                        <label htmlFor={`add-message-search-${c.case_id}`}>
                          Agregar correo puntual al expediente (busca entre los correos ya indexados, por asunto)
                        </label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <input
                            id={`add-message-search-${c.case_id}`}
                            type="text"
                            placeholder="Asunto contiene..."
                            value={addMessageQuery[c.case_id] || ''}
                            onChange={(e) => setAddMessageQuery((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchMessageToAdd(c.case_id)}
                            style={{ maxWidth: 280 }}
                            disabled={isClosed}
                          />
                          <ActionButton
                            icon={Search}
                            label={addMessageSearching === c.case_id ? 'Buscando…' : 'Buscar'}
                            loading={addMessageSearching === c.case_id}
                            disabled={isClosed}
                            onClick={() => handleSearchMessageToAdd(c.case_id)}
                          />
                          <ActionButton
                            icon={X}
                            label="Limpiar"
                            disabled={!addMessageQuery[c.case_id] && !addMessageResults[c.case_id]}
                            onClick={() => handleClearMessageSearch(c.case_id)}
                          />
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
                                  <ActionButton
                                    icon={Plus}
                                    label={
                                      alreadyLinked
                                        ? 'Ya está en el expediente'
                                        : addingMessageId === m.message_id
                                          ? 'Agregando…'
                                          : 'Agregar'
                                    }
                                    loading={addingMessageId === m.message_id}
                                    disabled={alreadyLinked || isClosed}
                                    onClick={() => handleAddMessageToCase(c.case_id, m.message_id)}
                                  />
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="ai-result">
                      <h5 style={{ margin: '0 0 8px' }}>📋 Seguimiento del expediente</h5>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor={`case-pending-action-${c.case_id}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            Acciones pendientes
                            <ActionButton icon={HelpCircle} label="Ayuda de formato Markdown" size="sm" onClick={() => setMdHelpOpen(true)} />
                          </label>
                          <textarea
                            id={`case-pending-action-${c.case_id}`}
                            placeholder="Qué falta hacer sobre este expediente… (admite formato Markdown, se convierte a HTML en el PDF exportado)"
                            value={pendingActionDraft[c.case_id] ?? ''}
                            onChange={(e) => setPendingActionDraft((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            rows={4}
                            style={{ width: '100%', resize: 'vertical' }}
                            disabled={isClosed}
                          />
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor={`case-next-review-${c.case_id}`}>Próxima revisión</label>
                          <input
                            id={`case-next-review-${c.case_id}`}
                            type="date"
                            value={nextReviewDraft[c.case_id] ?? ''}
                            onChange={(e) => setNextReviewDraft((prev) => ({ ...prev, [c.case_id]: e.target.value }))}
                            disabled={isClosed}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <ActionButton
                          icon={Save}
                          label={savingFollowUpId === c.case_id ? 'Guardando…' : 'Guardar seguimiento'}
                          variant="primary"
                          loading={savingFollowUpId === c.case_id}
                          disabled={isClosed}
                          onClick={() => handleSaveFollowUp(c.case_id)}
                        />
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
                          <label htmlFor={`case-new-note-${c.case_id}`} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                            Notas del auditor (texto libre, separado del resumen de IA)
                            <ActionButton icon={HelpCircle} label="Ayuda de formato Markdown" size="sm" onClick={() => setMdHelpOpen(true)} />
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
                            <ActionButton
                              icon={Save}
                              label={addingNoteId === c.case_id ? 'Agregando…' : 'Agregar nota'}
                              variant="primary"
                              loading={addingNoteId === c.case_id}
                              disabled={!(newNoteDraft[c.case_id] ?? '').trim() || isClosed}
                              onClick={() => handleAddNote(c.case_id)}
                            />
                          </div>
                          {detail && detail.notes.length > 0 && (
                            <div className="panel table-wrap mt-5">
                            <table>
                              <thead>
                                <tr>
                                  <th scope="col" style={{ width: 160 }}>Fecha</th>
                                  <th scope="col">Nota</th>
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
                                      <td className="md-content" dangerouslySetInnerHTML={{ __html: note.body }} />
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
                            <ActionButton
                              icon={Upload}
                              label={addingEvidenceId === c.case_id ? 'Agregando…' : 'Agregar evidencia'}
                              variant="primary"
                              loading={addingEvidenceId === c.case_id}
                              disabled={
                                !(newEvidenceGlosa[c.case_id] ?? '').trim() ||
                                !newEvidenceFile[c.case_id] ||
                                isClosed
                              }
                              onClick={() => handleAddEvidence(c.case_id)}
                            />
                          </div>
                          {detail && detail.evidence.length > 0 && (
                            <div className="panel table-wrap mt-5">
                            <table>
                              <thead>
                                <tr>
                                  <th scope="col" style={{ width: 160 }}>Fecha</th>
                                  <th scope="col">Glosa</th>
                                  <th scope="col" style={{ width: 210 }}>Evidencia</th>
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

                    <div className="add-message-search">
                      <button
                        type="button"
                        className="btn small btn-labeled"
                        onClick={() => toggleAuditLog(c.case_id)}
                      >
                        {auditLogOpenIds.has(c.case_id)
                          ? '🕘 Ocultar historial de auditoría ▾'
                          : `🕘 Historial de auditoría (${auditLogs[c.case_id]?.length ?? '…'}) ▸`}
                      </button>
                      {auditLogOpenIds.has(c.case_id) && (
                        <>
                          {loadingAuditLogId === c.case_id && (
                            <p style={{ color: 'var(--muted)', marginTop: 10 }}>Cargando historial…</p>
                          )}
                          {loadingAuditLogId !== c.case_id && (auditLogs[c.case_id]?.length ?? 0) === 0 && (
                            <p style={{ color: 'var(--muted)', marginTop: 10 }}>Sin cambios registrados todavía.</p>
                          )}
                          {loadingAuditLogId !== c.case_id && (auditLogs[c.case_id]?.length ?? 0) > 0 && (
                            <div className="panel table-wrap mt-5">
                              <table>
                                <thead>
                                  <tr>
                                    <th scope="col" style={{ width: 160 }}>Fecha</th>
                                    <th scope="col" style={{ width: 180 }}>Usuario</th>
                                    <th scope="col">Cambio</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {auditLogs[c.case_id]!.map((entry) => (
                                    <tr key={entry.audit_id}>
                                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                        {formatDateTime(entry.occurred_at)}
                                      </td>
                                      <td>{entry.user_display_name ?? '—'}</td>
                                      <td>{entry.description}</td>
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
                        <h5 style={{ margin: '0 0 8px' }}>🤖 Análisis de IA</h5>
                        {editingAiSummaryId === c.case_id ? (
                          <>
                            <textarea
                              value={aiSummaryDraft}
                              onChange={(e) => setAiSummaryDraft(e.target.value)}
                              rows={5}
                              style={{ width: '100%', resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <ActionButton
                                icon={Save}
                                label={savingAiSummaryId === c.case_id ? 'Guardando…' : 'Guardar'}
                                loading={savingAiSummaryId === c.case_id}
                                disabled={!aiSummaryDraft.trim()}
                                onClick={() => handleSaveAiSummary(c.case_id)}
                              />
                              <ActionButton
                                icon={X}
                                label="Cancelar"
                                disabled={savingAiSummaryId === c.case_id}
                                onClick={cancelEditAiSummary}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <p>{detail?.ai_summary_override || aiResult.summary}</p>
                            {detail?.ai_summary_override && (
                              <p style={{ color: 'var(--muted)', fontSize: '0.85em' }}>Editado por el auditor</p>
                            )}
                            <ActionButton
                              icon={Pencil}
                              label="Editar resumen"
                              disabled={isClosed}
                              onClick={() => startEditAiSummary(c.case_id, detail?.ai_summary_override || aiResult.summary)}
                            />
                          </>
                        )}
                        <p>
                          <strong>Prioridad sugerida:</strong> {PRIORITY_LABELS[aiResult.suggested_priority]}
                          {' · '}
                          <strong>Próxima acción:</strong> {aiResult.suggested_next_action}
                        </p>
                        <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong>Conclusión sugerida:</strong> {CASE_OUTCOME_LABELS[aiResult.suggested_outcome]}
                          <ActionButton
                            icon={Check}
                            label="Usar esta conclusión"
                            size="sm"
                            disabled={isClosed}
                            onClick={() =>
                              setOutcomeDraft((prev) => ({ ...prev, [c.case_id]: aiResult.suggested_outcome }))
                            }
                          />
                        </p>
                        {latestAiRun?.analyzed_at && (
                          <p style={{ color: 'var(--muted)', fontSize: '0.85em' }}>
                            Analizado el {formatDateTime(latestAiRun.analyzed_at)} · {latestAiRun.provider}/{latestAiRun.model}
                          </p>
                        )}
                      </div>
                    )}
                    {!aiResult && latestAiRun?.status === 'running' && (
                      <p style={{ color: 'var(--muted)', marginTop: 8 }}>
                        Procesando con IA desde {formatDateTime(latestAiRun.analyzed_at)}…
                      </p>
                    )}
                    {!aiResult && latestAiRun && latestAiRun.status !== 'success' && latestAiRun.status !== 'running' && (
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
                                  <ActionButton icon={Eye} label="Ver cuerpo" onClick={() => openBodyModal(eventMessage)} />
                                  {eventMessage.web_link && (
                                    <ActionButton
                                      icon={ExternalLink}
                                      label="Ver correo"
                                      href={eventMessage.web_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ marginLeft: 6 }}
                                    />
                                  )}
                                </div>
                              )}
                              {eventMessage && eventMessage.has_attachments && eventMessage.attachments.length === 0 && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                                  <span className="text-muted">Adjunto no trazado</span>
                                  <ActionButton
                                    icon={Paperclip}
                                    label={retracingMessageId === eventMessage.message_id ? 'Recuperando…' : 'Recuperar adjuntos'}
                                    loading={retracingMessageId === eventMessage.message_id}
                                    onClick={() => handleRetraceAttachments(c.case_id, eventMessage.message_id)}
                                  />
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
                                          <ActionButton
                                            icon={Check}
                                            label="Validar"
                                            disabled={isClosed}
                                            onClick={() => validateEvent(c.case_id, child.event_id)}
                                          />
                                        )}
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                              {event.determination_type !== 'validacion_manual' && (
                                <div className="event-actions">
                                  <ActionButton
                                    icon={Check}
                                    label="Marcar como validado manualmente"
                                    disabled={isClosed}
                                    onClick={() => validateEvent(c.case_id, event.event_id)}
                                  />
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
                              <th scope="col">Buzón</th>
                              <th scope="col">Asunto</th>
                              <th scope="col">De</th>
                              <th scope="col">Enviado</th>
                              <th scope="col" title="100% = mismo hilo o manual · 70% = palabra clave · 40% = heurística">
                                Confianza
                              </th>
                              <th scope="col">Adjuntos</th>
                              <th scope="col">Contenido</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.messages.map((m) => {
                              return (
                                <Fragment key={m.message_id}>
                                  <tr>
                                    <td>{m.mailbox_label || <span className="text-muted">sin etiquetar</span>}</td>
                                    <td>{m.subject || '(sin asunto)'}</td>
                                    <td>{m.from_address || '—'}</td>
                                    <td>{formatDateTime(m.sent_datetime)}</td>
                                    <td>{(m.confidence * 100).toFixed(0)}%</td>
                                    <td>
                                      {!m.has_attachments && <span className="text-muted">Sin adjunto</span>}
                                      {m.has_attachments && m.attachments.length === 0 && (
                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                          <span className="text-muted">Adjunto no trazado</span>
                                          <ActionButton
                                            icon={Paperclip}
                                            label={retracingMessageId === m.message_id ? 'Recuperando…' : 'Recuperar adjuntos'}
                                            loading={retracingMessageId === m.message_id}
                                            onClick={() => handleRetraceAttachments(c.case_id, m.message_id)}
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
                                        {(m.body_content || m.body_preview) ? (
                                          <ActionButton icon={Eye} label="Ver cuerpo" onClick={() => openBodyModal(m)} />
                                        ) : (
                                          <span className="text-muted">Sin contenido</span>
                                        )}
                                        {m.web_link && (
                                          <ActionButton icon={ExternalLink} label="Ver correo" href={m.web_link} target="_blank" rel="noreferrer" />
                                        )}
                                        <ActionButton
                                          icon={X}
                                          label="Quitar"
                                          variant="danger"
                                          disabled={isClosed}
                                          onClick={() =>
                                            setRemoveMessageTarget({
                                              caseId: c.case_id,
                                              messageId: m.message_id,
                                              subject: m.subject || '(sin asunto)',
                                            })
                                          }
                                        />
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
        description={
          aiPendingCounts.closed > 0 && aiPendingCounts.open === 0
            ? `Los ${aiPendingCounts.closed} expediente(s) sin análisis exitoso están todos cerrados. El análisis de IA no se ejecuta sobre expedientes cerrados, así que no hay ningún expediente abierto pendiente por procesar — reábrelos primero si querés incluirlos.`
            : aiPendingCounts.closed > 0
              ? `Hay ${aiPendingCounts.closed} expediente(s) cerrado(s) entre los que todavía no tienen un análisis exitoso. El análisis de IA no se puede ejecutar sobre expedientes cerrados — esta acción solo afectará a los ${aiPendingCounts.open} expediente(s) abierto(s) pendientes (los cerrados se omiten). El expediente no se cierra automáticamente — el resumen queda disponible para revisión y edición del auditor. ¿Continuar de todas formas?`
              : 'Esta acción ejecuta el análisis de IA sobre todos los expedientes que todavía no tienen un análisis exitoso. El expediente no se cierra automáticamente — el resumen queda disponible para revisión y edición del auditor. Dependiendo de la cantidad de expedientes puede tardar varios minutos.'
        }
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
        saving={sharingCase}
        onConfirm={handleConfirmCaseShares}
        onClose={() => setShareCaseTarget(null)}
      />

      <AskCaseModal
        open={askCaseTarget !== null}
        caseId={askCaseTarget?.case_id ?? null}
        caseTitle={askCaseTarget?.title ?? ''}
        onClose={() => setAskCaseTarget(null)}
      />

      <ConfirmModal
        open={conflictModal !== null}
        title="Este expediente cambió mientras lo tenías abierto"
        description={conflictModal?.message ?? ''}
        confirmLabel="Recargar expediente"
        confirmingLabel="Recargando…"
        confirmIcon="🔄"
        confirmDanger={false}
        confirming={reloadingConflictedCase}
        onCancel={() => setConflictModal(null)}
        onConfirm={handleReloadConflictedCase}
      />

      <ReassignOwnerModal
        open={reassignOwnerTarget !== null}
        caseTitle={reassignOwnerTarget?.title ?? ''}
        previousOwnerLabel={reassignOwnerTarget?.previous_owner_label ?? null}
        reassigning={reassigningOwner}
        onConfirm={handleReassignOwnerConfirm}
        onClose={() => setReassignOwnerTarget(null)}
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
            <div className="form-grid mt-6">
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
                <label htmlFor="sendEmailBody" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Cuerpo (Markdown — se precarga con la última nota del auditor, se convierte a HTML al enviar)
                  <ActionButton icon={HelpCircle} label="Ayuda de formato Markdown" size="sm" onClick={() => setMdHelpOpen(true)} />
                </label>
                <textarea
                  id="sendEmailBody"
                  rows={8}
                  value={sendEmailForm.body}
                  onChange={(e) => setSendEmailForm((prev) => ({ ...prev, body: e.target.value }))}
                  style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
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
            <button
              type="button"
              className="btn small btn-labeled"
              disabled={!sendEmailForm.body.trim() || loadingEmailPreview}
              onClick={handlePreviewEmail}
            >
              {loadingEmailPreview ? 'Generando…' : '👁 Vista previa'}
            </button>
            <button type="button" className="btn small primary btn-labeled" disabled={sendingEmail} onClick={handleSendEmail}>
              {sendingEmail ? 'Enviando…' : '✉ Enviar'}
            </button>
          </div>
        </div>
      </div>

      <MarkdownHelpModal open={mdHelpOpen} onClose={() => setMdHelpOpen(false)} />

      <div className={`modal-backdrop${emailPreviewOpen ? ' open' : ''}`}>
        <div className="modal wide">
          <div className="modal-body">
            <h3>Vista previa del correo</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 10px', marginBottom: 10, fontSize: 13 }}>
              <strong>Para</strong>
              <span>{sendEmailForm.to || '—'}</span>
              {sendEmailForm.cc && (
                <>
                  <strong>CC</strong>
                  <span>{sendEmailForm.cc}</span>
                </>
              )}
              <strong>Asunto</strong>
              <span>{sendEmailForm.subject || '—'}</span>
            </div>
            <MessageBodyView content={emailPreviewHtml} contentType="html" />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn small btn-labeled" onClick={() => setEmailPreviewOpen(false)}>
              ✕ Cerrar
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-backdrop${mergeModalOpen ? ' open' : ''}`}>
        <div className="modal compact">
          <div className="modal-body">
            <h3>Fusionar expedientes</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
              Se crea un expediente nuevo con todos los correos, notas, evidencia y línea de tiempo de los{' '}
              {selectedCaseIds.size} expedientes seleccionados. <strong>Los expedientes origen se eliminan</strong> —
              queda un registro de la fusión en la línea de tiempo del expediente nuevo.
            </p>
            <div className="form-grid mt-6">
              <div className="field full">
                <label htmlFor="merge-title">Nombre del expediente final</label>
                <input
                  id="merge-title"
                  type="text"
                  placeholder="ej. GFCH-260702220"
                  value={mergeTitle}
                  onChange={(e) => setMergeTitle(e.target.value)}
                />
              </div>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 14, marginBottom: 6 }}>
              Se van a fusionar:
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
              {cases
                ?.filter((c) => selectedCaseIds.has(c.case_id))
                .map((c) => (
                  <li key={c.case_id}>
                    {c.title}
                    {c.external_code ? ` (${c.external_code})` : ''}
                  </li>
                ))}
            </ul>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn small btn-labeled" disabled={merging} onClick={() => setMergeModalOpen(false)}>
              ✕ Cancelar
            </button>
            <button
              type="button"
              className="btn small primary btn-labeled"
              disabled={merging || !mergeTitle.trim()}
              onClick={handleConfirmMerge}
            >
              {merging ? 'Fusionando…' : '⛙ Fusionar'}
            </button>
          </div>
        </div>
      </div>

    </section>
  )
}
