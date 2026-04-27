import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/dexie'
import { useSession } from '../context/SessionContext'
import type {
  ItemOrden,
  OrdenFabricacion,
  Semielaborado,
  ProductoTerminado,
  EstadoEtapa,
} from '../types'

/**
 * Cola de trabajo del operario.
 *
 * Muestra los items que el planificador le asignó (operario_id = sesión)
 * o, si todavía no hay asignación nominal, los items de su sector que
 * aún no tienen operario.
 *
 * Cada item es UNA pieza física: una bobina F1, una cuba, una parte activa,
 * un ensamble final, etc. Al tocar un item navega a /operacion/:itemId.
 */

const BADGE_BY_ESTADO: Record<EstadoEtapa, { label: string; clases: string }> = {
  pendiente: { label: 'Pendiente', clases: 'bg-slate-600 text-slate-100' },
  en_proceso: { label: 'En proceso', clases: 'bg-emerald-600 text-white' },
  demorada: { label: 'Demorada', clases: 'bg-red-600 text-white' },
  completada: { label: 'Completada', clases: 'bg-slate-500 text-slate-200' },
}

type ItemConContexto = ItemOrden & {
  orden?: OrdenFabricacion
  semielaborado?: Semielaborado
  productoTerminado?: ProductoTerminado
  asignadoAMi: boolean
}

export default function MisItemsScreen() {
  const { operario } = useSession()
  const navigate = useNavigate()

  const items = useLiveQuery<ItemConContexto[]>(async () => {
    if (!operario) return []

    // 1) Items asignados nominalmente al operario logueado
    const asignados = await db.items
      .where('operario_id')
      .equals(operario.id)
      .filter((i) => ['pendiente', 'en_proceso', 'demorada'].includes(i.estado))
      .toArray()

    // 2) Items del sector del operario que están sin asignar
    //    (fallback: el operario los puede tomar si nadie los reclamó)
    const delSector = await db.items
      .where('sector_codigo')
      .equals(operario.sector_codigo)
      .filter(
        (i) =>
          ['pendiente', 'en_proceso', 'demorada'].includes(i.estado) &&
          !i.operario_id,
      )
      .toArray()

    // Dedupe por id
    const map = new Map<string, ItemOrden>()
    for (const i of asignados) map.set(i.id, i)
    for (const i of delSector) if (!map.has(i.id)) map.set(i.id, i)
    const filas = Array.from(map.values())

    // Hidratar relaciones
    const ordenIds = Array.from(new Set(filas.map((i) => i.orden_id)))
    const seCods = Array.from(
      new Set(filas.map((i) => i.semielaborado_codigo).filter((c): c is string => !!c)),
    )
    const ptCods = Array.from(
      new Set(
        filas
          .map((i) => i.producto_terminado_codigo)
          .filter((c): c is string => !!c),
      ),
    )

    const [ordenes, ses, pts] = await Promise.all([
      db.ordenes.bulkGet(ordenIds),
      db.semielaborados.bulkGet(seCods),
      db.productosTerminados.bulkGet(ptCods),
    ])

    const ordenMap = new Map(
      ordenes.filter((o): o is OrdenFabricacion => !!o).map((o) => [o.id, o]),
    )
    const seMap = new Map(
      ses.filter((s): s is Semielaborado => !!s).map((s) => [s.codigo, s]),
    )
    const ptMap = new Map(
      pts.filter((p): p is ProductoTerminado => !!p).map((p) => [p.codigo, p]),
    )

    return filas
      .map((i) => ({
        ...i,
        orden: ordenMap.get(i.orden_id),
        semielaborado: i.semielaborado_codigo
          ? seMap.get(i.semielaborado_codigo)
          : undefined,
        productoTerminado: i.producto_terminado_codigo
          ? ptMap.get(i.producto_terminado_codigo)
          : undefined,
        asignadoAMi: i.operario_id === operario.id,
      }))
      .sort((a, b) => {
        // 1. asignado a mí primero
        if (a.asignadoAMi !== b.asignadoAMi) return a.asignadoAMi ? -1 : 1
        // 2. en_proceso/demorada antes que pendiente
        const prio = (e: ItemConContexto) =>
          e.estado === 'en_proceso' ? 0 : e.estado === 'demorada' ? 1 : 2
        if (prio(a) !== prio(b)) return prio(a) - prio(b)
        // 3. prioridad ascendente (menor = más urgente)
        if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad
        // 4. fecha planificada
        return (a.inicio_planificado ?? '') < (b.inicio_planificado ?? '') ? -1 : 1
      })
  }, [operario?.id])

  if (!operario) return null

  return (
    <div className="h-full p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-touch-xl font-bold">Mis tareas</h1>
          <p className="text-touch-base text-slate-400">
            Sector:{' '}
            <span className="font-semibold text-slate-200">
              {operario.sector_codigo}
            </span>
          </p>
        </div>
        <div className="text-sm text-slate-400">
          {items?.length ?? 0} pendiente{items?.length === 1 ? '' : 's'}
        </div>
      </header>

      {items === undefined && (
        <p className="text-slate-400 text-touch-base">Cargando…</p>
      )}

      {items && items.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-slate-400">
            <p className="text-touch-lg mb-2">No tenés tareas asignadas.</p>
            <p className="text-touch-base">
              Esperá a que el planificador te asigne piezas a fabricar.
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
        {items?.map((i) => {
          const badge = BADGE_BY_ESTADO[i.estado]
          const piezaCodigo =
            i.tipo === 'semielaborado'
              ? i.semielaborado?.codigo ?? i.semielaborado_codigo
              : i.productoTerminado?.codigo ?? i.producto_terminado_codigo
          const piezaDesc =
            i.tipo === 'semielaborado'
              ? i.semielaborado?.descripcion
              : i.productoTerminado?.descripcion
          const fasePill =
            i.fase ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-violet-700 text-white">
                {i.fase}
              </span>
            ) : null

          return (
            <button
              key={i.id}
              onClick={() => navigate(`/operacion/${i.id}`)}
              className="bg-slate-800 hover:bg-slate-700 active:scale-[0.99] transition
                         rounded-xl p-5 text-left border border-slate-700 shadow-lg flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-touch-lg font-bold text-inelpa-accent">
                      {piezaCodigo ?? '(pieza)'}
                    </div>
                    {fasePill}
                    {i.tipo === 'ensamble_final' && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-orange-700 text-white">
                        ENSAMBLE
                      </span>
                    )}
                  </div>
                  {piezaDesc && (
                    <p className="text-sm text-slate-300 line-clamp-2 mt-1">
                      {piezaDesc}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${badge.clases}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 mt-1">
                <div>
                  Orden{' '}
                  <span className="font-semibold text-slate-300">
                    {i.orden?.codigo ?? '—'}
                  </span>{' '}
                  · Unidad {i.unidad_index}/{i.orden?.cantidad_unidades ?? '?'}
                </div>
                {i.codigo_interno_fabricacion && (
                  <div className="text-slate-500 font-mono">
                    {i.codigo_interno_fabricacion}
                  </div>
                )}
              </div>

              {!i.asignadoAMi && (
                <div className="text-[11px] text-amber-300 italic">
                  Disponible — no está asignado a nadie.
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
