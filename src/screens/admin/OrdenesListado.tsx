import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { syncCatalogos } from '../../db/syncCatalogos'
import type {
  OrdenFabricacion,
  ItemOrden,
  EstadoOrden,
  SectorCodigo,
} from '../../types'

/**
 * Listado de órdenes con progreso por sector y acción de cancelar.
 *
 * El "progreso" se calcula contando items por sector y su estado.
 * Bajamos directo de Supabase (no Dexie) para tener el estado más actual.
 */

type Filtro = 'activas' | 'todas' | 'completadas' | 'canceladas'

interface OrdenConItems extends OrdenFabricacion {
  items: ItemOrden[]
}

const BADGE_ORDEN: Record<EstadoOrden, { label: string; clases: string }> = {
  pendiente: { label: 'Pendiente', clases: 'bg-slate-600 text-slate-100' },
  en_proceso: { label: 'En proceso', clases: 'bg-emerald-600 text-white' },
  completada: { label: 'Completada', clases: 'bg-sky-700 text-white' },
  cancelada: { label: 'Cancelada', clases: 'bg-red-800 text-red-100' },
}

const SECTORES: SectorCodigo[] = [
  'bobinado-at',
  'bobinado-bt',
  'herreria',
  'montajes-pa',
  'montajes-ph',
]

export default function OrdenesListado() {
  const [ordenes, setOrdenes] = useState<OrdenConItems[] | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('activas')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      let q = supabase
        .from('ordenes_fabricacion')
        .select('*')
        .order('created_at', { ascending: false })

      if (filtro === 'activas') q = q.in('estado', ['pendiente', 'en_proceso'])
      else if (filtro === 'completadas') q = q.eq('estado', 'completada')
      else if (filtro === 'canceladas') q = q.eq('estado', 'cancelada')

      const { data: os, error: errO } = await q
      if (errO) throw errO

      const ids = (os ?? []).map((o) => o.id)
      if (ids.length === 0) {
        setOrdenes([])
        return
      }

      const { data: items, error: errI } = await supabase
        .from('items_orden')
        .select('*')
        .in('orden_id', ids)
      if (errI) throw errI

      const porOrden = new Map<string, ItemOrden[]>()
      for (const i of items ?? []) {
        const arr = porOrden.get(i.orden_id) ?? []
        arr.push(i as ItemOrden)
        porOrden.set(i.orden_id, arr)
      }

      setOrdenes(
        (os ?? []).map((o) => ({
          ...(o as OrdenFabricacion),
          items: porOrden.get(o.id) ?? [],
        })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar órdenes')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro])

  const cancelarOrden = async (orden: OrdenConItems) => {
    if (
      !confirm(
        `¿Seguro que querés cancelar la orden ${orden.codigo}?\n\nEsto NO borra los eventos ya registrados, pero la saca del panel de operarios.`,
      )
    ) {
      return
    }
    const { error } = await supabase
      .from('ordenes_fabricacion')
      .update({ estado: 'cancelada' })
      .eq('id', orden.id)
    if (error) {
      alert(`No se pudo cancelar: ${error.message}`)
      return
    }
    await syncCatalogos()
    await cargar()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <FiltroBtn active={filtro === 'activas'} onClick={() => setFiltro('activas')}>
            Activas
          </FiltroBtn>
          <FiltroBtn active={filtro === 'completadas'} onClick={() => setFiltro('completadas')}>
            Completadas
          </FiltroBtn>
          <FiltroBtn active={filtro === 'canceladas'} onClick={() => setFiltro('canceladas')}>
            Canceladas
          </FiltroBtn>
          <FiltroBtn active={filtro === 'todas'} onClick={() => setFiltro('todas')}>
            Todas
          </FiltroBtn>
        </div>
        <button
          onClick={() => void cargar()}
          disabled={cargando}
          className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
        >
          {cargando ? 'Cargando…' : '↻ Refrescar'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900 text-red-100 border border-red-700">
          {error}
        </div>
      )}

      {ordenes === null && <p className="text-slate-400">Cargando órdenes…</p>}

      {ordenes && ordenes.length === 0 && (
        <div className="py-16 text-center text-slate-500">
          <p className="text-touch-base">No hay órdenes en esta categoría.</p>
        </div>
      )}

      <div className="space-y-3">
        {ordenes?.map((o) => (
          <OrdenRow key={o.id} orden={o} onCancelar={() => cancelarOrden(o)} />
        ))}
      </div>
    </div>
  )
}

function OrdenRow({
  orden,
  onCancelar,
}: {
  orden: OrdenConItems
  onCancelar: () => void
}) {
  const badge = BADGE_ORDEN[orden.estado]
  const activable = orden.estado === 'pendiente' || orden.estado === 'en_proceso'

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-touch-lg font-bold text-inelpa-accent">{orden.codigo}</span>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${badge.clases}`}>
              {badge.label}
            </span>
            {orden.producto_terminado_codigo && (
              <span className="text-xs font-mono text-slate-300">
                {orden.producto_terminado_codigo} × {orden.cantidad_unidades}
              </span>
            )}
          </div>
          {orden.cliente && (
            <div className="text-slate-300 text-sm mt-1">{orden.cliente}</div>
          )}
          {orden.descripcion && (
            <div className="text-slate-400 text-sm mt-1">{orden.descripcion}</div>
          )}
          {orden.fecha_entrega_estimada && (
            <div className="text-xs text-slate-500 mt-1">
              Entrega: {orden.fecha_entrega_estimada}
            </div>
          )}
        </div>

        {activable && (
          <button
            onClick={onCancelar}
            className="px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm"
          >
            Cancelar orden
          </button>
        )}
      </div>

      <ProgresoSectores items={orden.items} />
    </div>
  )
}

function ProgresoSectores({ items }: { items: ItemOrden[] }) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic">
        Sin items expandidos. Crear nueva orden con BOM.
      </p>
    )
  }

  // Agrupar items por sector y contar estados
  const porSector = new Map<SectorCodigo, { total: number; completados: number; en_curso: number }>()
  for (const i of items) {
    const stats = porSector.get(i.sector_codigo) ?? { total: 0, completados: 0, en_curso: 0 }
    stats.total++
    if (i.estado === 'completada') stats.completados++
    else if (i.estado === 'en_proceso' || i.estado === 'demorada') stats.en_curso++
    porSector.set(i.sector_codigo, stats)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {SECTORES.filter((s) => porSector.has(s)).map((s) => {
        const stats = porSector.get(s)!
        const pct = Math.round((stats.completados / stats.total) * 100)
        const color =
          pct === 100
            ? 'bg-sky-500'
            : stats.en_curso > 0
              ? 'bg-emerald-500'
              : 'bg-slate-500'
        return (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${color}`} title={`${pct}% completo`} />
            <span className="text-xs text-slate-300">
              {labelSector(s)}{' '}
              <span className="text-slate-500">
                {stats.completados}/{stats.total}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function labelSector(s: SectorCodigo): string {
  switch (s) {
    case 'bobinado-at': return 'Bob AT'
    case 'bobinado-bt': return 'Bob BT'
    case 'herreria': return 'Herrería'
    case 'montajes-pa': return 'Mont PA'
    case 'montajes-ph': return 'Mont PH'
  }
}

function FiltroBtn({
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
      className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
        active
          ? 'bg-inelpa-accent text-slate-900'
          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
      }`}
    >
      {children}
    </button>
  )
}
