import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { db } from '../db/dexie'
import type { Operario } from '../types'

/**
 * Sesión del operario en el PC panel.
 *
 * El "login" es por PIN y no usa Supabase Auth (los operarios son personal
 * de planta, no usuarios de BD). Se persiste en Dexie.kv para que un F5
 * o pérdida de conexión no obliguen a re-ingresar el PIN.
 *
 * La sesión dura hasta que el operario toque "Cerrar sesión" o cambie de turno.
 */

interface SessionValue {
  operario: Operario | null
  /** Intenta loguear con un PIN. Retorna el operario si matchea, o null. */
  loginConPin: (pin: number) => Promise<Operario | null>
  logout: () => Promise<void>
  /** Mientras carga la sesión persistida al arrancar la app. */
  cargando: boolean
}

const SessionContext = createContext<SessionValue | null>(null)

const KV_KEY = 'sesion_operario_id'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [operario, setOperario] = useState<Operario | null>(null)
  const [cargando, setCargando] = useState(true)

  // Al montar: intenta recuperar la sesión persistida
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const row = await db.kv.get(KV_KEY)
        const operarioId = row?.value as string | undefined
        if (operarioId) {
          const op = await db.operarios.get(operarioId)
          if (op && !cancelado) setOperario(op)
        }
      } finally {
        if (!cancelado) setCargando(false)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const loginConPin = async (pin: number): Promise<Operario | null> => {
    const op = await db.operarios.where('pin').equals(pin).first()
    if (!op || !op.activo) return null
    await db.kv.put({ key: KV_KEY, value: op.id })
    setOperario(op)
    return op
  }

  const logout = async () => {
    await db.kv.delete(KV_KEY)
    setOperario(null)
  }

  return (
    <SessionContext.Provider value={{ operario, loginConPin, logout, cargando }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>')
  return ctx
}
