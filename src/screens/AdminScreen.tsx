import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  esAdminDesbloqueado,
  desbloquearAdmin,
  bloquearAdmin,
} from '../lib/adminAuth'
import NuevaOrdenForm from './admin/NuevaOrdenForm'
import OrdenesListado from './admin/OrdenesListado'
import PlanificadorScreen from './admin/PlanificadorScreen'

/**
 * Panel de administración (MVP).
 *
 * Accesible desde el link discreto en la pantalla de login o tecleando
 * /admin en la URL. Protegido por un PIN admin propio (VITE_ADMIN_PIN,
 * default 9999). La sesión admin vive sólo mientras esté abierta la
 * pestaña del navegador.
 *
 * Tabs:
 *  - Órdenes activas (ver / cancelar)
 *  - Nueva orden
 */

type Tab = 'listado' | 'nueva' | 'planificador'

export default function AdminScreen() {
  const [desbloqueado, setDesbloqueado] = useState(esAdminDesbloqueado())

  if (!desbloqueado) {
    return <AdminLock onUnlock={() => setDesbloqueado(true)} />
  }
  return <AdminPanel onLock={() => setDesbloqueado(false)} />
}

function AdminLock({ onUnlock }: { onUnlock: () => void }) {
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const intentar = (pinStr: string) => {
    if (desbloquearAdmin(pinStr)) {
      onUnlock()
    } else {
      setError('PIN admin incorrecto.')
      setPin('')
    }
  }

  const agregar = (d: string) => {
    if (pin.length >= 4) return
    const nuevo = pin + d
    setPin(nuevo)
    setError(null)
    if (nuevo.length === 4) intentar(nuevo)
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center">
        <h1 className="text-touch-xl font-bold mb-2">Acceso a administración</h1>
        <p className="text-touch-base text-slate-400">Ingresá el PIN admin (4 dígitos)</p>
      </div>

      <div className="flex gap-4 my-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-16 h-16 rounded-lg border-2 flex items-center justify-center text-4xl font-bold transition ${
              pin.length > i
                ? 'border-inelpa-accent bg-slate-700 text-inelpa-accent'
                : 'border-slate-600 bg-slate-800 text-slate-500'
            }`}
          >
            {pin.length > i ? '•' : ''}
          </div>
        ))}
      </div>

      {error && <div className="text-red-400 text-touch-base font-semibold">{error}</div>}

      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => agregar(d)} className="btn-secondary !min-h-[5rem] !text-4xl">
            {d}
          </button>
        ))}
        <button
          onClick={() => navigate('/login')}
          className="btn-secondary !min-h-[5rem] !text-base"
        >
          Volver
        </button>
        <button onClick={() => agregar('0')} className="btn-secondary !min-h-[5rem] !text-4xl">
          0
        </button>
        <button
          onClick={() => setPin((p) => p.slice(0, -1))}
          className="btn-secondary !min-h-[5rem] !text-xl"
        >
          ←
        </button>
      </div>
    </div>
  )
}

function AdminPanel({ onLock }: { onLock: () => void }) {
  const [tab, setTab] = useState<Tab>('listado')
  const navigate = useNavigate()

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h1 className="text-touch-lg font-bold">Administración</h1>
          <p className="text-xs text-slate-400">Gestión de órdenes de fabricación</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/login')}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
          >
            Ir a panel operario
          </button>
          <button
            onClick={() => {
              bloquearAdmin()
              onLock()
            }}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
          >
            Cerrar admin
          </button>
        </div>
      </header>

      <nav className="px-6 bg-slate-900 border-b border-slate-700 flex gap-2">
        <TabBtn active={tab === 'listado'} onClick={() => setTab('listado')}>
          Órdenes activas
        </TabBtn>
        <TabBtn active={tab === 'planificador'} onClick={() => setTab('planificador')}>
          Planificador
        </TabBtn>
        <TabBtn active={tab === 'nueva'} onClick={() => setTab('nueva')}>
          + Nueva orden
        </TabBtn>
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'listado' && <OrdenesListado />}
        {tab === 'planificador' && <PlanificadorScreen />}
        {tab === 'nueva' && <NuevaOrdenForm onCreada={() => setTab('planificador')} />}
      </div>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 font-semibold border-b-2 transition ${
        active
          ? 'border-inelpa-accent text-inelpa-accent'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
