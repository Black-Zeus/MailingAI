import { useEffect, useState } from 'react'
import { Sidebar, type ViewName } from './components/Sidebar'
import { ToastProvider } from './context/ToastContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LoginView } from './views/LoginView'
import { ChangePasswordGate } from './views/ChangePasswordGate'
import { NewJobView } from './views/NewJobView'
import { JobsView } from './views/JobsView'
import { CasesView } from './views/CasesView'
import { DashboardView } from './views/DashboardView'
import { MessagesView } from './views/MessagesView'
import { AttachmentsView } from './views/AttachmentsView'
import { SettingsView } from './views/SettingsView'
import { getAIHealth } from './api/client'
import type { CaseSeedPrefill } from './types/cases'

const TITLES: Record<ViewName, { title: string; subtitle: string }> = {
  new: { title: 'Nueva consulta', subtitle: 'Definí el alcance de un nuevo trabajo de análisis.' },
  jobs: { title: 'Cola de trabajos', subtitle: 'Seguimiento de ejecuciones históricas y en curso.' },
  cases: { title: 'Expedientes', subtitle: 'Casos reconstruidos por correlación de correos.' },
  dashboard: { title: 'Dashboard', subtitle: 'Resumen ejecutivo de expedientes.' },
  messages: { title: 'Mensajes', subtitle: 'Buscar mensajes y carpetas ya indexados.' },
  attachments: { title: 'Adjuntos', subtitle: 'Evidencia real del buzón: archivos, hash e historial de vínculos.' },
  settings: { title: 'Configuración', subtitle: 'Estado real de la política e integraciones de IA.' },
}

function AppShell() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [view, setView] = useState<ViewName>('dashboard')
  const [aiPolicy, setAiPolicy] = useState<string | null>(null)
  const [refreshJobs, setRefreshJobs] = useState(0)
  const [casePrefill, setCasePrefill] = useState<CaseSeedPrefill | null>(null)
  const [openCaseId, setOpenCaseId] = useState<number | null>(null)

  useEffect(() => {
    getAIHealth()
      .then((h) => setAiPolicy(h.policy))
      .catch(() => setAiPolicy(null))
  }, [])

  // Defensa extra ademas de ocultar el item del menu (Sidebar.tsx): un
  // usuario no admin nunca debe quedar parado en Configuracion, ni siquiera
  // si "view" llego a ese valor por otro camino (ej. quedo en el estado de
  // una sesion anterior).
  useEffect(() => {
    if (view === 'settings' && !isAdmin) {
      setView('dashboard')
    }
  }, [view, isAdmin])

  function goToJobs() {
    setRefreshJobs((n) => n + 1)
    setView('jobs')
  }

  function goToCasesWithSeed(prefill: CaseSeedPrefill) {
    setCasePrefill(prefill)
    setView('cases')
  }

  function goToCaseId(caseId: number) {
    setOpenCaseId(caseId)
    setView('cases')
  }

  const { title, subtitle } = TITLES[view]

  return (
    <div className="shell">
      <Sidebar activeView={view} onNavigate={setView} />
      <main>
        <header>
          <div className="header-title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {aiPolicy && <div className="scope-pill">● Política IA: {aiPolicy === 'local_only' ? 'solo local' : aiPolicy}</div>}
        </header>
        <div className="content">
          {view === 'new' && <NewJobView onJobCreated={goToJobs} />}
          {view === 'jobs' && (
            <JobsView
              refreshSignal={refreshJobs}
              onCreateNew={() => setView('new')}
              onCreateCase={goToCasesWithSeed}
            />
          )}
          {view === 'cases' && (
            <CasesView
              prefill={casePrefill}
              onPrefillConsumed={() => setCasePrefill(null)}
              openCaseId={openCaseId}
              onOpenCaseIdConsumed={() => setOpenCaseId(null)}
            />
          )}
          {view === 'dashboard' && <DashboardView onOpenCase={goToCaseId} />}
          {view === 'messages' && <MessagesView onCreateCase={goToCasesWithSeed} />}
          {view === 'attachments' && <AttachmentsView />}
          {view === 'settings' && isAdmin && <SettingsView />}
        </div>
      </main>
    </div>
  )
}

function AuthGate() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="login-screen">Cargando…</div>
  }
  if (!user) {
    return <LoginView />
  }
  if (user.must_change_password) {
    return <ChangePasswordGate />
  }
  return <AppShell />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProvider>
  )
}
