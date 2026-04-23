import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/dexie'
import { useSession } from '../context/SessionContext'
import type { EtapaOrden, OrdenFabricacion, EstadoEtapa } from '../types'

/**
 * Selector de etapa de trabajo.
 *
 * Muestra todas las etapas del sector del operario logueado que están
 * en estado pendiente / en_proceso / demorada, con su orden de fabricación
 * asociada. Al tocar una, navega a /operacion/:etapaId.
 */

const BADGE_BY_ESTADO: Record<EstadoEtapa, { label: string; clases: string }> = {
  pendiente: { label: 'Pendiente', clases: 'bg-slate-600 text-slate-100' },
  en_proceso: { label: 'En proceso', clases: 'bg-emerald-600 text-white' },
  demorada: { label: 'Demorada', clases: 'bg-red-600 text-white' },
  completada: { label: 'Completada', clases: 'bg-slate-500 text-slate-200' },
}

type EtapaConOrden = EtapaOrden & { orden?: OrdenFabricacion }

export default function EtapasScreen() {
  const { operario } = useSession()
  const navigate = useNavigate()

  const etapas = useLiveQuery<EtapaConOrden[]>(async () => {
    if (!operario) return []

    const rows = await db.etapas
      .where('sector_codigo')
      .equals(operario.sector_codigo)
      .filter((e) => ['pendiente', 'en_proceso', 'demorada'].includes(e.estado))
      .toArray()

    // Traemos las órdenes asociadas
    const ordenIds = Array.from(new Set(rows.map((e) => e.orden_id)))
    const ordenes = await db.ordenes.bulkGet(ordenIds)
    const ordenesMap = new Map(
      ordenes.filter((o): o is OrdenFabricacion => !!o).map((o) => [o.id, o]),
    )

    return rows
      .map((e) => ({ ...e, orden: ordenesMap.get(e.orden_id) }))
      .sort((a, b) => {
        // en_proceso/demorada primero, después por secuencia
        const prio = (e: EtapaConOrden) =>
          e.estado === 'en_proceso' ? 0 : e.estado === 'demorada' ? 1 : 2
        return prio(a) - prio(b) || a.secuencia - b.secuencia
      })
  }, [operario?.id])

  if (!operario) return null

  return (
    <div className="h-full p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-touch-xl font-bold">Etapas de trabajo</h1>
          <p className="text-touch-base text-slate-400">
            Sector: <span className="font-semibold text-slate-200">{operario.sector_codigo}</span>
          </p>
        </div>
      </header>

      {etapas === undefined && (
        <p className="text-slate-400 text-touch-base">Cargando…</p>
      )}

      {etapas && etapas.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-slate-400">
            <p className="text-touch-lg mb-2">No hay etapas asignadas a tu sector.</p>
            <p className="text-touch-base">
              Consultá con tu supervisor o esperá a que se carguen órdenes nuevas.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto">
        {etapas?.map((e) => {
          const badge = BADGE_BY_ESTADO[e.estado]
          return (
            <button
              key={e.id}
              onClick={() => navigate(`/operacion/${e.id}`)}
              className="bg-slate-800 hover:bg-slate-700 active:scale-[0.99] transition
                         rounded-xl p-5 text-left border border-slate-700 shadow-lg flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-touch-lg font-bold text-inelpa-accent">
                    {e.orden?.codigo ?? '(sin código)'}
                  </div>
                  {e.orden?.cliente && (
                    <div className="text-touch-base text-slate-300">{e.orden.cliente}</div>
                  )}
                </div>
                <span
                  className={`text-sm font-semibold px-3 py-1 rounded-full whitespace-nowrap ${badge.clases}`}
                >
                  {badge.label}
                </span>
              </div>
              {e.orden?.descripcion && (
                <p className="text-slate-400 text-sm line-clamp-2">{e.orden.descripcion}</p>
              )}
              <div className="text-xs text-slate-500 mt-1">
                Secuencia {e.secuencia} · {e.sector_codigo}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
