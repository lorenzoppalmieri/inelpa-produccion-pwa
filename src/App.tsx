import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import LoginScreen from './screens/LoginScreen'
import EtapasScreen from './screens/EtapasScreen'
import OperacionScreen from './screens/OperacionScreen'
import AdminScreen from './screens/AdminScreen'
import SupervisorScreen from './screens/SupervisorScreen'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { usePendingSyncCount } from './hooks/usePendingSyncCount'
import { useSession } from './context/SessionContext'
import type { ReactNode } from 'react'

export default function App() {
  const online = useOnlineStatus()
  const pending = usePendingSyncCount()
  const { operario, logout, cargando } = useSession()
  const location = useLocation()

  if (cargando) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        Cargando…
      </div>
    )
  }

  // El panel admin y el tablero de supervisor traen su propio chrome
  // (header y tabs), así que en /admin y /supervisor ocultamos el header
  // operario para no duplicar barras.
  const esAdmin = location.pathname.startsWith('/admin')
  const esSupervisor = location.pathname.startsWith('/supervisor')
  const ocultarHeader = esAdmin || esSupervisor

  return (
    <div className="h-full flex flex-col">
      {!ocultarHeader && (
        <header className="px-6 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between gap-4">
          <span className="text-touch-base font-bold tracking-wide">
            INELPA · Producción
          </span>

          <div className="flex items-center gap-4 text-sm">
            {operario && (
              <div className="flex items-center gap-3">
                <span className="text-slate-300">
                  {operario.nombre} {operario.apellido}
                  <span className="text-slate-500 ml-2">({operario.sector_codigo})</span>
                </span>
                <button
                  onClick={() => void logout()}
                  className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100"
                >
                  Cerrar sesión
                </button>
              </div>
            )}
            <span
              className={`px-3 py-1 rounded-full font-medium ${
                online ? 'bg-emerald-600' : 'bg-amber-600'
              }`}
              title={online ? 'Conectado' : 'Sin conexión — los eventos se guardan localmente'}
            >
              {online ? 'Online' : 'Offline'}
            </span>
            {pending > 0 && (
              <span
                className="px-3 py-1 rounded-full bg-slate-600 font-medium"
                title="Eventos pendientes de sincronizar con Supabase"
              >
                {pending} pendiente{pending === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </header>
      )}

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuth>
                <LoginScreen />
              </RedirectIfAuth>
            }
          />
          <Route
            path="/etapas"
            element={
              <RequireAuth>
                <EtapasScreen />
              </RequireAuth>
            }
          />
          <Route
            path="/operacion/:etapaId"
            element={
              <RequireAuth>
                <OperacionScreen />
              </RequireAuth>
            }
          />
          <Route path="/admin" element={<AdminScreen />} />
          <Route path="/supervisor" element={<SupervisorScreen />} />
          <Route path="/" element={<Navigate to="/etapas" replace />} />
          <Route path="*" element={<Navigate to="/etapas" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { operario } = useSession()
  const location = useLocation()
  if (!operario) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <>{children}</>
}

function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { operario } = useSession()
  if (operario) {
    return <Navigate to="/etapas" replace />
  }
  return <>{children}</>
}
