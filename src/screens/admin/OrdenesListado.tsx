import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { syncCatalogos } from '../../db/syncCatalogos'
import type {
  OrdenFabricacion,
  EtapaOrden,
  EstadoOrden,
  EstadoEtapa,
  SectorCodigo,
} from '../../types'

/**
 * Listado de órdenes con progreso de etapas y acción de cancelar.
 *
 * Por qué bajamos directo de Supabase y no usamos Dexie acá:
 *  - El admin quiere ver el estado MÁS actual, incluido órdenes
 *    recién creadas desde otro PC.
 *  - El listado se refresca manualmente o al entrar a la tab.
 *  - Incluye órdenes completadas y canceladas (filtro), que Dexie no cachea.
 */

type Filtro = 'activas' | 'todas' | 'completadas' | 'canceladas'

interface OrdenConEtapas extends OrdenFabricacion {
  etapas: EtapaOrden[]
}

const BADGE_ORDEN: Record<EstadoOrden, { label: string; clases: string }> = {
  pendiente: { label: 'Pendiente', clases: 'bg-slate-600 text-slate-100' },
  en_proceso: { label: 'En proceso', clases: 'bg-emerald-600 text-white' },
  completada: { label: 'Completada', clases: 'bg-sky-700 text-white' },
  cancelada: { label: 'Cancelada', clases: 'bg-red-800 text-red-100' },
}

const DOT_ETAPA: Record<EstadoEtapa, string> = {
  pendiente: 'bg-slate-500',
  en_proceso: 'bg-emerald-500',
  demorada: 'bg-red-500',
  completada: 'bg-sky-500',
}

export default function OrdenesListado() {
  const [ordenes, setOrdenes] = useState<OrdenConEtapas[] | null>(null)
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

      const { data: es, error: errE } = await supabase
        .from('etapas_orden')
        .select('*')
        .in('orden_id', ids)
        .order('secuencia', { ascending: true })
      if (errE) throw errE

      const porOrden = new Map<string, EtapaOrden[]>()
      for (const e of es ?? []) {
        const arr = porOrden.get(e.orden_id) ?? []
        arr.push(e as EtapaOrden)
        porOrden.set(e.orden_id, arr)
      }

      setOrdenes(
        (os ?? []).map((o) => ({
          ...(o as OrdenFabricacion),
          etapas: porOrden.get(o.id) ?? [],
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

  const cancelarOrden = async (orden: OrdenConEtapas) => {
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
  orden: OrdenConEtapas
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

      <ProgresoEtapas etapas={orden.etapas} />
    </div>
  )
}

function ProgresoEtapas({ etapas }: { etapas: EtapaOrden[] }) {
  if (etapas.length === 0) {
    return <p className="text-xs text-slate-500 italic">Sin etapas configuradas.</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {etapas.map((e, idx) => (
        <div key={e.id} className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${DOT_ETAPA[e.estado]}`}
            title={`${labelSector(e.sector_codigo)} — ${e.estado}`}
          />
          <span className="text-xs text-slate-300">{labelSector(e.sector_codigo)}</span>
          {idx < etapas.length - 1 && <span className="text-slate-600">→</span>}
        </div>
      ))}
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
