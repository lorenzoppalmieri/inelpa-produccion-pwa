import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'

/**
 * Login por PIN para el PC panel en planta.
 *
 * UX optimizada para operarios con guantes:
 *  - Teclado numérico grande (botones ≥ 80×80 px).
 *  - PIN de 4 dígitos (rango 1000-9999).
 *  - Auto-submit al tipear el 4to dígito.
 *  - Feedback visual inmediato si el PIN no existe.
 */
export default function LoginScreen() {
  const { loginConPin } = useSession()
  const navigate = useNavigate()

  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [intentando, setIntentando] = useState(false)

  const intentarLogin = async (pinStr: string) => {
    setIntentando(true)
    setError(null)
    const num = parseInt(pinStr, 10)
    const op = Number.isFinite(num) ? await loginConPin(num) : null
    if (op) {
      navigate('/cola', { replace: true })
    } else {
      setError('PIN inválido. Verificá con tu supervisor.')
      setPin('')
    }
    setIntentando(false)
  }

  const agregarDigito = (d: string) => {
    if (intentando) return
    if (pin.length >= 4) return
    const nuevo = pin + d
    setPin(nuevo)
    setError(null)
    if (nuevo.length === 4) {
      void intentarLogin(nuevo)
    }
  }

  const borrar = () => {
    if (intentando) return
    setPin((p) => p.slice(0, -1))
    setError(null)
  }

  const limpiar = () => {
    if (intentando) return
    setPin('')
    setError(null)
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center">
        <h1 className="text-touch-xl font-bold mb-2">Ingresá tu PIN</h1>
        <p className="text-touch-base text-slate-400">4 dígitos</p>
      </div>

      {/* Display del PIN */}
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

      {error && (
        <div className="text-red-400 text-touch-base font-semibold">{error}</div>
      )}

      {/* Teclado numérico */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            onClick={() => agregarDigito(d)}
            disabled={intentando}
            className="btn-secondary !min-h-[5rem] !text-4xl"
          >
            {d}
          </button>
        ))}
        <button
          onClick={limpiar}
          disabled={intentando}
          className="btn-secondary !min-h-[5rem] !text-xl"
        >
          Limpiar
        </button>
        <button
          onClick={() => agregarDigito('0')}
          disabled={intentando}
          className="btn-secondary !min-h-[5rem] !text-4xl"
        >
          0
        </button>
        <button
          onClick={borrar}
          disabled={intentando}
          className="btn-secondary !min-h-[5rem] !text-xl"
        >
          ←
        </button>
      </div>

      {intentando && (
        <p className="text-slate-400 text-touch-base">Validando…</p>
      )}

      {/* Accesos discretos para supervisor y admin — abajo del todo */}
      <div className="mt-4 flex gap-6">
        <button
          onClick={() => navigate('/supervisor')}
          className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-4"
        >
          Tablero supervisor
        </button>
        <button
          onClick={() => navigate('/admin')}
          className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-4"
        >
          Administración
        </button>
      </div>
    </div>
  )
}
