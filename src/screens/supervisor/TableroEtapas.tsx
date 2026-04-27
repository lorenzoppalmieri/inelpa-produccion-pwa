import { useEffect, useMemo, useRef, useState } from 'react'
import type { SectorCodigo } from '../../types'
import { cargarTablero, formatoMinutos, type ItemEnTablero } from './tableroData'

/**
 * Tablero de supervisor — vista tipo "war room".
 *
 * - Grid con una tarjeta por item activo (bobina, cuba, ensamble, etc).
 * - Auto-refresh cada 15s (polling).
 * - Filtro por sector (o ver todo).
 * - Semáforo por estado: gris pendiente, verde en proceso, rojo demorada.
 * - KPIs resumen arriba.
 *
 * Tras el refactor a items, cada tarjeta es UN componente físico, no
 * una "etapa" abstracta de orden. Eso da una visión mucho más operativa
 * del piso de planta.
 */

const SECTORES: Array<{ codigo: SectorCodigo | 'all'; label: string }> = [
  { codigo: 'all', label: 'Todos' },
  { codigo: 'bobinado-at', label: 'Bobinado AT' },
  { codigo: 'bobinado-bt', label: 'Bobinado BT' },
  { codigo: 'herreria', label: 'Herrería' },
  { codigo: 'montajes-pa', label: 'Montajes PA' },
  { codigo: 'montajes-ph', label: 'Montajes PH' },
]

const INTERVALO_MS = 15_000

export default function TableroEtapas() {
  const [sector, setSector] = useState<SectorCodigo | 'all'>('all')
  const [items, setItems] = useState<ItemEnTablero[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null)
  const timerRef = useRef<number | null>(null)

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await cargarTablero(sector)
      setItems(data)
      setUltimaActualizacion(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el tablero')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void cargar()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => void cargar(), INTERVALO_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sector])

  const resumen = useMemo(() => {
    if (!items) return { pendiente: 0, en_proceso: 0, demorada: 0 }
    return items.reduce(
      (acc, e) => {
        if (e.item.estado === 'pendiente') acc.pendiente++
        else if (e.item.estado === 'en_proceso') acc.en_proceso++
        else if (e.item.estado === 'demorada') acc.demorada++
        return acc
      },
      { pendiente: 0, en_proceso: 0, demorada: 0 },
    )
  }, [items])

  // Ordenamos: demoradas primero (urgencia), luego en_proceso, luego pendientes,
  // y dentro de cada grupo por fecha de entrega.
  const ordenadas = useMemo(() => {
    if (!items) return []
    const prio = { demorada: 0, en_proceso: 1, pendiente: 2, completada: 3 } as const
    return [...items].sort((a, b) => {
      const p = prio[a.item.estado] - prio[b.item.estado]
      if (p !== 0) return p
      const fa = a.orden.fecha_entrega_estimada ?? '9999-12-31'
      const fb = b.orden.fecha_entrega_estimada ?? '9999-12-31'
      return fa.localeCompare(fb)
    })
  }, [items])

  return (
    <div className="p-6 space-y-4">
      {/* KPIs resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="En proceso" valor={resumen.en_proceso} color="bg-emerald-700" />
        <Kpi label="Demoradas" valor={resumen.demorada} color="bg-red-700" />
        <Kpi label="Pendientes" valor={resumen.pendiente} color="bg-slate-700" />
        <Kpi
          label={ultimaActualizacion ? 'Actualizado' : 'Sin datos'}
          valor={
            ultimaActualizacion
              ? ultimaActualizacion.toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '—'
          }
          color="bg-slate-800"
        />
      </div>

      {/* Filtro de sector */}
      <div className="flex flex-wrap items-center gap-2">
        {SECTORES.map((s) => (
          <button
            key={s.codigo}
            onClick={() => setSector(s.codigo)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
              sector === s.codigo
                ? 'bg-inelpa-accent text-slate-900'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => void cargar()}
          disabled={cargando}
          className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
          title="Refresco manual (auto cada 15 s)"
        >
          {cargando ? 'Cargando…' : '↻ Refrescar'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900 text-red-100 border border-red-700">
          {error}
        </div>
      )}

      {items === null && <p className="text-slate-400">Cargando tablero…</p>}

      {items && items.length === 0 && (
        <div className="py-16 text-center text-slate-500">
          <p className="text-touch-base">
            No hay items activos{sector !== 'all' ? ' en este sector' : ''}.
          </p>
        </div>
      )}

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {ordenadas.map((it) => (
          <ItemCard key={it.item.id} data={it} />
        ))}
      </div>
    </div>
  )
}

function Kpi({ label, valor, color }: { label: string; valor: number | string; color: string }) {
  return (
    <div className={`rounded-xl p-4 text-white ${color}`}>
      <div className="text-xs uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1">{valor}</div>
    </div>
  )
}

function ItemCard({ data }: { data: ItemEnTablero }) {
  const { item, orden, puesto, operarioAsignado, demoraActiva } = data
  const estado = item.estado
  const color =
    estado === 'demorada'
      ? 'border-red-500 bg-red-950/40'
      : estado === 'en_proceso'
        ? 'border-emerald-500 bg-emerald-950/30'
        : 'border-slate-600 bg-slate-900'
  const badge =
    estado === 'demorada'
      ? 'bg-red-600 text-white'
      : estado === 'en_proceso'
        ? 'bg-emerald-600 text-white'
        : 'bg-slate-600 text-slate-100'
  const badgeLabel =
    estado === 'demorada'
      ? 'DEMORADA'
      : estado === 'en_proceso'
        ? 'EN PROCESO'
        : 'PENDIENTE'

  return (
    <div className={`rounded-xl border-l-4 ${color} border border-slate-700 p-4 flex flex-col gap-3 shadow-lg`}>
      {/* Header: pieza + badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-touch-base font-bold text-inelpa-accent truncate">
              {data.pieza_codigo}
            </div>
            {data.fase && (
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-violet-700 text-white">
                {data.fase}
              </span>
            )}
            {data.tipo === 'ensamble_final' && (
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-orange-700 text-white">
                ENSAMBLE
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            <span className="font-semibold text-slate-300">{orden.codigo}</span>
            {' · '}
            Unidad {data.unidad_index}/{orden.cantidad_unidades}
            {orden.cliente && <> · {orden.cliente}</>}
          </div>
        </div>
        <span className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${badge}`}>
          {badgeLabel}
        </span>
      </div>

      {data.codigo_interno_fabricacion && (
        <div className="text-xs font-mono text-amber-300 bg-slate-800/60 rounded px-2 py-1 inline-block self-start">
          {data.codigo_interno_fabricacion}
        </div>
      )}

      {data.pieza_descripcion && (
        <div className="text-xs text-slate-400 line-clamp-2">{data.pieza_descripcion}</div>
      )}

      {/* Demora activa destacada */}
      {demoraActiva && (
        <div className="bg-red-900/60 border border-red-700 rounded-lg p-2 text-sm">
          <div className="font-bold text-red-100">
            ⚠ Demora abierta · {formatoMinutos(demoraActiva.minutos_abierta)}
          </div>
          <div className="text-red-200 text-xs mt-1">
            {demoraActiva.causa_codigo}
            {demoraActiva.causa_descripcion && ` — ${demoraActiva.causa_descripcion}`}
          </div>
          {demoraActiva.observacion && (
            <div className="text-red-300 text-xs mt-1 italic">{demoraActiva.observacion}</div>
          )}
        </div>
      )}

      {/* Datos del item */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Dato label="Sector" valor={labelSectorCorto(item.sector_codigo)} />
        <Dato
          label="Puesto"
          valor={puesto?.nombre ?? '—'}
        />
        <Dato
          label="Operario"
          valor={
            operarioAsignado
              ? `${operarioAsignado.nombre} ${operarioAsignado.apellido}`
              : '—'
          }
        />
        <Dato
          label={estado === 'pendiente' ? 'Sin iniciar' : 'En estado'}
          valor={
            estado === 'pendiente'
              ? '—'
              : formatoMinutos(data.minutosEnEstado)
          }
        />
      </div>

      {/* Footer: totales y fecha entrega */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
        <span>
          {data.totalDemoras} demora{data.totalDemoras === 1 ? '' : 's'} totales
          {item.inicio_real_at && ` · activa ${formatoMinutos(data.minutosTotalActivo)}`}
        </span>
        {orden.fecha_entrega_estimada && (
          <span title="Fecha de entrega estimada">📅 {orden.fecha_entrega_estimada}</span>
        )}
      </div>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-slate-200 font-semibold truncate">{valor}</div>
    </div>
  )
}

function labelSectorCorto(s: SectorCodigo): string {
  switch (s) {
    case 'bobinado-at':
      return 'Bobinado AT'
    case 'bobinado-bt':
      return 'Bobinado BT'
    case 'herreria':
      return 'Herrería'
    case 'montajes-pa':
      return 'Montajes PA'
    case 'montajes-ph':
      return 'Montajes PH'
  }
}
