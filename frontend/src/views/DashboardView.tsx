import { Fragment, useEffect, useState } from 'react'
import { ApiError, getCasesByOutcome, getDashboardStats } from '../api/client'
import type { CaseDashboardStats, CaseSummary } from '../types/cases'
import { CASE_OUTCOME_LABELS } from '../types/cases'
import { KpiCard } from '../components/KpiCard'
import { ActionButton } from '../components/ActionButton'
import { CaseDetailModal } from '../components/CaseDetailModal'
import { ArrowUpRight, ChevronDown, ChevronRight, Eye } from 'lucide-react'
import { useToast } from '../context/ToastContext'

interface DashboardViewProps {
  onOpenCase: (caseId: number) => void
}

const SIN_DEFINIR = '(sin definir)'

export function DashboardView({ onOpenCase }: DashboardViewProps) {
  const { showToast } = useToast()
  const [stats, setStats] = useState<CaseDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [openOutcome, setOpenOutcome] = useState<string | null>(null)
  const [casesByOutcome, setCasesByOutcome] = useState<Record<string, CaseSummary[]>>({})
  const [loadingOutcome, setLoadingOutcome] = useState<string | null>(null)
  const [modalCaseId, setModalCaseId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await getDashboardStats()
        if (!cancelled) setStats(data)
      } catch (err) {
        if (!cancelled) showToast(err instanceof ApiError ? err.message : 'No se pudo cargar el dashboard.', true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleOutcome(outcome: string) {
    if (openOutcome === outcome) {
      setOpenOutcome(null)
      return
    }
    setOpenOutcome(outcome)
    if (!casesByOutcome[outcome]) {
      setLoadingOutcome(outcome)
      try {
        const apiOutcome = outcome === SIN_DEFINIR ? 'none' : outcome
        const data = await getCasesByOutcome(apiOutcome)
        setCasesByOutcome((prev) => ({ ...prev, [outcome]: data }))
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'No se pudieron cargar los expedientes.', true)
      } finally {
        setLoadingOutcome(null)
      }
    }
  }

  function handleViewCase(c: CaseSummary) {
    if (c.status === 'closed') {
      setModalCaseId(c.case_id)
    } else {
      onOpenCase(c.case_id)
    }
  }

  if (loading) {
    return <p className="text-muted">Cargando resumen…</p>
  }
  if (!stats) {
    return <p className="text-muted">No se pudo cargar el resumen.</p>
  }

  const outcomeRows = Object.entries(stats.by_outcome).sort((a, b) => b[1] - a[1])

  return (
    <>
      <div className="kpis kpis-6">
        <KpiCard label="Total de expedientes" value={stats.total} />
        <KpiCard label="Abiertos" value={stats.open_count} color="var(--success)" />
        <KpiCard label="Cerrados" value={stats.closed_count} />
        <KpiCard label="Revisión vencida" value={stats.overdue_review_count} color="var(--danger)" />
        <KpiCard label="IA desactualizada" value={stats.stale_ai_count} color="var(--warning)" />
        <KpiCard label="Sin analizar con IA" value={stats.no_ai_count} color="var(--warning)" />
      </div>

      <div className="panel table-wrap" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 40 }} aria-label="Expandir"></th>
              <th scope="col">Conclusión</th>
              <th scope="col" style={{ width: 140 }}>Expedientes</th>
            </tr>
          </thead>
          <tbody>
            {outcomeRows.map(([outcome, count]) => {
              const isOpen = openOutcome === outcome
              const rows = casesByOutcome[outcome]
              return (
                <Fragment key={outcome}>
                  <tr>
                    <td>
                      <ActionButton
                        icon={isOpen ? ChevronDown : ChevronRight}
                        label={isOpen ? 'Ocultar expedientes' : 'Ver expedientes'}
                        onClick={() => toggleOutcome(outcome)}
                      />
                    </td>
                    <td>{CASE_OUTCOME_LABELS[outcome as keyof typeof CASE_OUTCOME_LABELS] ?? outcome}</td>
                    <td>{count}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={3} style={{ background: 'var(--panel-2)' }}>
                        {loadingOutcome === outcome && (
                          <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '8px 0' }}>Cargando…</p>
                        )}
                        {loadingOutcome !== outcome && rows && rows.length === 0 && (
                          <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '8px 0' }}>Sin expedientes.</p>
                        )}
                        {loadingOutcome !== outcome && rows && rows.length > 0 && (
                          <div className="table-wrap">
                          <table style={{ margin: '6px 0' }}>
                            <tbody>
                              {rows.map((c) => (
                                <tr key={c.case_id}>
                                  <td>{c.title}</td>
                                  <td>
                                    <span className={`badge ${c.status}`}>{c.status === 'open' ? 'Abierto' : 'Cerrado'}</span>
                                  </td>
                                  <td style={{ width: 170 }}>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <ActionButton icon={Eye} label="Ver expediente" onClick={() => handleViewCase(c)} />
                                      <ActionButton
                                        icon={ArrowUpRight}
                                        label="Ir a expediente"
                                        onClick={() => onOpenCase(c.case_id)}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <CaseDetailModal open={modalCaseId !== null} caseId={modalCaseId} onClose={() => setModalCaseId(null)} />
    </>
  )
}
