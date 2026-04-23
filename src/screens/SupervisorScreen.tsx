import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  esSupervisorDesbloqueado,
  desbloquearSupervisor,
  bloquearSupervisor,
} from '../lib/supervisorAuth'
import TableroEtapas from './supervisor/TableroEtapas'

/**
 * Pantalla de supervisor (MVP).
 *
 * Accesible desde el link discreto en /login o tipeando /supervisor en la URL.
 * Protegida por un PIN propio (VITE_SUPERVISOR_PIN, default 8888) separado
 * del PIN admin: un jefe de sector ve el tablero sin tener permisos para
 * crear/cancelar órdenes.
 *
 * Contiene el tablero en tiempo real (TableroEtapas) con auto-refresh cada 15s.
 */
export default function SupervisorScreen() {
  const [desbloqueado, setDesbloqueado] = useState(esSupervisorDesbloqueado())

  if (!desbloqueado) {
    return <SupervisorLock onUnlock={() => setDesbloqueado(true)} />
  }
  return <SupervisorShell onLock={() => setDesbloqueado(false)} />
}

function SupervisorLock({ onUnlock }: { onUnlock: () => void }) {
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const intentar = (pinStr: string) => {
    if (desbloquearSupervisor(pinStr)) {
      onUnlock()
    } else {
      setError('PIN de supervisor incorrecto.')
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
        <h1 className="text-touch-xl font-bold mb-2">Acceso al tablero de supervisor</h1>
        <p className="text-touch-base text-slate-400">Ingresá el PIN de supervisor (4 dígitos)</p>
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

function SupervisorShell({ onLock }: { onLock: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h1 className="text-touch-lg font-bold">Tablero de supervisor</h1>
          <p className="text-xs text-slate-400">Vista en vivo de etapas en planta — refresco cada 15 s</p>
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
              bloquearSupervisor()
              onLock()
            }}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
          >
            Cerrar supervisor
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <TableroEtapas />
      </div>
    </div>
  )
}
