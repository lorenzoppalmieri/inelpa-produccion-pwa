import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import type {
  ItemOrden,
  PuestoTrabajo,
  OrdenFabricacion,
  Semielaborado,
  ProductoTerminado,
  SectorCodigo,
} from '../../types'

/**
 * Tablero de capacidad por máquina (heatmap día × puesto).
 *
 * Para cada puesto de trabajo, mostramos cuántos items tiene planificados
 * cada día del período seleccionado. Un item "ocupa" un día si la fecha
 * cae dentro del rango [inicio_planificado, fin_planificado] (ambos
 * inclusive). Si sólo tiene una de las dos fechas, ocupa ese único día.
 *
 * El color de cada celda comunica el nivel de saturación:
 *   0 items     → gris (libre)
 *   1-2 items   → verde (carga liviana)
 *   3-4 items   → amarillo (en uso intenso)
 *   5+ items    → rojo (saturado, rever asignación)
 *
 * Al clickear una celda mostramos el detalle de items que cargan ese día
 * en esa máquina (orden, pieza, fase, código interno, operario).
 *
 * Ítems SIN ninguna fecha planificada no aparecen en el heatmap pero los
 * contamos en la barra de resumen ("X items sin planificar") así el
 * planificador sabe que tiene cosas pendientes de poner en agenda.
 */

type Periodo = 'semana' | 'dos_semanas' | 'mes'

const SECTORES_FILTRO: { codigo: SectorCodigo | 'all'; label: string }[] = [
  { codigo: 'all', label: 'Todos los sectores' },
  { codigo: 'bobinado-at', label: 'Bobinado AT' },
  { codigo: 'bobinado-bt', label: 'Bobinado BT' },
  { codigo: 'herreria', label: 'Herrería' },
  { codigo: 'montajes-pa', label: 'Montajes PA' },
  { codigo: 'montajes-ph', label: 'Montajes PH' },
]

export default function CapacidadScreen() {
  const items = useLiveQuery(() => db.items.toArray(), [], [] as ItemOrden[])
  const puestos = useLiveQuery(() => db.puestos.toArray(), [], [] as PuestoTrabajo[])
  const ordenes = useLiveQuery(() => db.ordenes.toArray(), [], [] as OrdenFabricacion[])
  const semis = useLiveQuery(
    () => db.semielaborados.toArray(),
    [],
    [] as Semielaborado[],
  )
  const pts = useLiveQuery(
    () => db.productosTerminados.toArray(),
    [],
    [] as ProductoTerminado[],
  )

  const [periodo, setPeriodo] = useState<Periodo>('dos_semanas')
  const [sectorFiltro, setSectorFiltro] = useState<SectorCodigo | 'all'>('all')
  const [celdaSeleccionada, setCeldaSeleccionada] = useState<
    { puestoId: string; dia: string } | null
  >(null)

  const ordenById = useMemo(
    () => new Map(ordenes.map((o) => [o.id, o])),
    [ordenes],
  )
  const semiByCodigo = useMemo(
    () => new Map(semis.map((s) => [s.codigo, s])),
    [semis],
  )
  const ptByCodigo = useMemo(
    () => new Map(pts.map((p) => [p.codigo, p])),
    [pts],
  )

  // Generar el rango de días del período (ISO yyyy-mm-dd)
  const dias = useMemo(() => {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const cantidadDias =
      periodo === 'semana' ? 7 : periodo === 'dos_semanas' ? 14 : 31
    const arr: string[] = []
    for (let i = 0; i < cantidadDias; i++) {
      const d = new Date(hoy)
      d.setDate(hoy.getDate() + i)
      arr.push(d.toISOString().slice(0, 10))
    }
    return arr
  }, [periodo])

  // Filtrar items relevantes y normalizar fechas
  const itemsActivos = useMemo(() => {
    return items.filter((i) => {
      if (i.estado === 'completada') return false
      const orden = ordenById.get(i.orden_id)
      if (!orden) return false
      if (orden.estado === 'cancelada' || orden.estado === 'completada') return false
      if (sectorFiltro !== 'all' && i.sector_codigo !== sectorFiltro) return false
      return true
    })
  }, [items, ordenById, sectorFiltro])

  // Puestos a mostrar (filtrados por sector si corresponde)
  const puestosVisibles = useMemo(() => {
    return puestos
      .filter((p) => sectorFiltro === 'all' || p.sector_codigo === sectorFiltro)
      .sort((a, b) => {
        if (a.sector_codigo !== b.sector_codigo)
          return a.sector_codigo.localeCompare(b.sector_codigo)
        return a.nombre.localeCompare(b.nombre)
      })
  }, [puestos, sectorFiltro])

  // Construir el mapa: puestoId → diaISO → items[]
  // Un item se cuenta en un día si está dentro de [inicio_planificado, fin_planificado].
  // Si sólo tiene una fecha, sólo ocupa ese día. Si no tiene ninguna, no aparece.
  const cargaPorPuestoDia = useMemo(() => {
    const map = new Map<string, Map<string, ItemOrden[]>>()
    for (const it of itemsActivos) {
      if (!it.puesto_trabajo_id) continue
      const ini = it.inicio_planificado?.slice(0, 10) ?? null
      const fin = it.fin_planificado?.slice(0, 10) ?? null
      if (!ini && !fin) continue

      const desde = ini ?? fin!
      const hasta = fin ?? ini!
      // Iterar día por día dentro del rango
      const fechaIni = new Date(desde + 'T00:00:00')
      const fechaFin = new Date(hasta + 'T00:00:00')
      if (fechaFin < fechaIni) continue

      for (
        let f = new Date(fechaIni);
        f <= fechaFin;
        f.setDate(f.getDate() + 1)
      ) {
        const isoDia = f.toISOString().slice(0, 10)
        if (!dias.includes(isoDia)) continue // Fuera del período visible
        const porPuesto = map.get(it.puesto_trabajo_id) ?? new Map()
        const arr = porPuesto.get(isoDia) ?? []
        arr.push(it)
        porPuesto.set(isoDia, arr)
        map.set(it.puesto_trabajo_id, porPuesto)
      }
    }
    return map
  }, [itemsActivos, dias])

  // Resumen
  const resumen = useMemo(() => {
    let conPlan = 0
    let sinPlan = 0
    let sinPuesto = 0
    for (const it of itemsActivos) {
      if (!it.puesto_trabajo_id) {
        sinPuesto++
      } else if (!it.inicio_planificado && !it.fin_planificado) {
        sinPlan++
      } else {
        conPlan++
      }
    }
    return { conPlan, sinPlan, sinPuesto }
  }, [itemsActivos])

  const itemsCelda = useMemo(() => {
    if (!celdaSeleccionada) return []
    const porPuesto = cargaPorPuestoDia.get(celdaSeleccionada.puestoId)
    return porPuesto?.get(celdaSeleccionada.dia) ?? []
  }, [celdaSeleccionada, cargaPorPuestoDia])

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-touch-lg font-bold">Capacidad por máquina</h2>
          <p className="text-sm text-slate-400">
            Saturación de cada puesto según la planificación cargada. Tocá una
            celda para ver los items asignados a ese día.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Pill color="emerald">{resumen.conPlan} planificados</Pill>
          <Pill color="amber">{resumen.sinPlan} sin fechas</Pill>
          <Pill color="slate">{resumen.sinPuesto} sin puesto</Pill>
        </div>
      </header>

      {/* Filtros */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 flex flex-wrap items-center gap-3">
        <Selector
          label="Período"
          value={periodo}
          onChange={(v) => setPeriodo(v as Periodo)}
          options={[
            { value: 'semana', label: 'Próximos 7 días' },
            { value: 'dos_semanas', label: 'Próximos 14 días' },
            { value: 'mes', label: 'Próximos 31 días' },
          ]}
        />
        <Selector
          label="Sector"
          value={sectorFiltro}
          onChange={(v) => setSectorFiltro(v as SectorCodigo | 'all')}
          options={SECTORES_FILTRO.map((s) => ({
            value: s.codigo,
            label: s.label,
          }))}
        />
        <div className="ml-auto flex items-center gap-3 text-xs">
          <Leyenda color="bg-slate-700" texto="0" />
          <Leyenda color="bg-emerald-700" texto="1-2" />
          <Leyenda color="bg-amber-600" texto="3-4" />
          <Leyenda color="bg-red-600" texto="5+" />
        </div>
      </div>

      {/* Heatmap */}
      {puestosVisibles.length === 0 ? (
        <div className="py-16 text-center text-slate-500">
          <p>No hay puestos en este sector.</p>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto">
          <table className="border-collapse min-w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-slate-900 text-left text-xs font-semibold text-slate-300 px-3 py-2 border-b border-slate-700 min-w-[180px]">
                  Puesto
                </th>
                {dias.map((d) => (
                  <th
                    key={d}
                    className="bg-slate-900 text-center text-[10px] font-semibold text-slate-400 px-1 py-2 border-b border-slate-700 border-l border-slate-800 min-w-[40px]"
                  >
                    <DiaHeader iso={d} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {puestosVisibles.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/50">
                  <td className="sticky left-0 z-10 bg-slate-800 text-xs px-3 py-1.5 border-b border-slate-700">
                    <div className="font-semibold text-slate-200">{p.nombre}</div>
                    <div className="text-[10px] text-slate-500">
                      {labelSectorCorto(p.sector_codigo)} · {p.tipo}
                    </div>
                  </td>
                  {dias.map((d) => {
                    const itemsDelDia =
                      cargaPorPuestoDia.get(p.id)?.get(d) ?? []
                    const count = itemsDelDia.length
                    const seleccionada =
                      celdaSeleccionada?.puestoId === p.id &&
                      celdaSeleccionada?.dia === d
                    return (
                      <td
                        key={d}
                        onClick={() =>
                          setCeldaSeleccionada(
                            seleccionada ? null : { puestoId: p.id, dia: d },
                          )
                        }
                        className={`text-center p-0 border-b border-slate-700 border-l border-slate-800 cursor-pointer transition ${
                          seleccionada ? 'ring-2 ring-amber-400 ring-inset' : ''
                        }`}
                      >
                        <div
                          className={`w-full h-9 flex items-center justify-center text-xs font-bold ${colorCelda(
                            count,
                          )} ${count > 0 ? 'text-white' : 'text-slate-500'}`}
                          title={`${p.nombre} · ${formatoFechaCorto(d)} · ${count} item${count === 1 ? '' : 's'}`}
                        >
                          {count > 0 ? count : ''}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle de celda seleccionada */}
      {celdaSeleccionada && (
        <DetalleCelda
          puesto={
            puestosVisibles.find((p) => p.id === celdaSeleccionada.puestoId) ??
            null
          }
          dia={celdaSeleccionada.dia}
          items={itemsCelda}
          ordenById={ordenById}
          semiByCodigo={semiByCodigo}
          ptByCodigo={ptByCodigo}
          onCerrar={() => setCeldaSeleccionada(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------

function DetalleCelda({
  puesto,
  dia,
  items,
  ordenById,
  semiByCodigo,
  ptByCodigo,
  onCerrar,
}: {
  puesto: PuestoTrabajo | null
  dia: string
  items: ItemOrden[]
  ordenById: Map<string, OrdenFabricacion>
  semiByCodigo: Map<string, Semielaborado>
  ptByCodigo: Map<string, ProductoTerminado>
  onCerrar: () => void
}) {
  return (
    <div className="bg-slate-800 border border-amber-700/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-touch-base font-bold text-amber-300">
            {puesto?.nombre ?? 'Puesto'} · {formatoFechaLargo(dia)}
          </div>
          <div className="text-xs text-slate-400">
            {items.length} item{items.length === 1 ? '' : 's'} en este día
          </div>
        </div>
        <button
          onClick={onCerrar}
          className="text-slate-400 hover:text-slate-200 text-sm"
        >
          ✕ Cerrar
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No hay items asignados a esta máquina ese día.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const orden = ordenById.get(it.orden_id)
            const piezaCodigo =
              it.tipo === 'semielaborado'
                ? semiByCodigo.get(it.semielaborado_codigo ?? '')?.codigo ??
                  it.semielaborado_codigo ??
                  '(sin código)'
                : ptByCodigo.get(it.producto_terminado_codigo ?? '')?.codigo ??
                  it.producto_terminado_codigo ??
                  '(ensamble)'
            const piezaDesc =
              it.tipo === 'semielaborado'
                ? semiByCodigo.get(it.semielaborado_codigo ?? '')?.descripcion
                : ptByCodigo.get(it.producto_terminado_codigo ?? '')
                    ?.descripcion ?? 'Ensamble final'

            return (
              <div
                key={it.id}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-amber-400">
                    {piezaCodigo}
                  </span>
                  {it.fase && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-700 text-white">
                      {it.fase}
                    </span>
                  )}
                  {it.tipo === 'ensamble_final' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-700 text-white">
                      ENSAMBLE
                    </span>
                  )}
                  <span className="text-xs text-slate-400">
                    Orden{' '}
                    <span className="font-semibold text-slate-300">
                      {orden?.codigo ?? '—'}
                    </span>{' '}
                    · Unidad {it.unidad_index}
                  </span>
                  {it.codigo_interno_fabricacion && (
                    <span className="text-[11px] font-mono text-amber-300 bg-slate-800 rounded px-1.5 py-0.5">
                      {it.codigo_interno_fabricacion}
                    </span>
                  )}
                </div>
                {piezaDesc && (
                  <div className="text-xs text-slate-500 mt-1 line-clamp-1">
                    {piezaDesc}
                  </div>
                )}
                <div className="text-[11px] text-slate-500 mt-1">
                  Plan: {it.inicio_planificado?.slice(0, 10) ?? '—'} →{' '}
                  {it.fin_planificado?.slice(0, 10) ?? '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DiaHeader({ iso }: { iso: string }) {
  const d = new Date(iso + 'T00:00:00')
  const dia = d.getDate()
  const dow = d.toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 3)
  const esFinde = d.getDay() === 0 || d.getDay() === 6
  return (
    <div className={esFinde ? 'opacity-60' : ''}>
      <div className="text-[9px] uppercase">{dow}</div>
      <div className="text-xs">{dia}</div>
    </div>
  )
}

function Selector({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-slate-400">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`w-4 h-4 rounded ${color}`} />
      <span className="text-slate-400">{texto}</span>
    </div>
  )
}

function Pill({
  color,
  children,
}: {
  color: 'emerald' | 'amber' | 'slate'
  children: React.ReactNode
}) {
  const clases =
    color === 'emerald'
      ? 'bg-emerald-900 text-emerald-200 border-emerald-700'
      : color === 'amber'
        ? 'bg-amber-900 text-amber-200 border-amber-700'
        : 'bg-slate-700 text-slate-200 border-slate-600'
  return (
    <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${clases}`}>
      {children}
    </span>
  )
}

// Umbrales del heatmap. Pensados para máquinas que normalmente procesan 1-3
// items en paralelo. Si la realidad de Inelpa es distinta, se ajustan acá
// (se podría hacer configurable más adelante).
function colorCelda(count: number): string {
  if (count === 0) return 'bg-slate-700'
  if (count <= 2) return 'bg-emerald-700'
  if (count <= 4) return 'bg-amber-600'
  return 'bg-red-600'
}

function formatoFechaCorto(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

function formatoFechaLargo(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function labelSectorCorto(s: SectorCodigo): string {
  switch (s) {
    case 'bobinado-at': return 'Bob AT'
    case 'bobinado-bt': return 'Bob BT'
    case 'herreria': return 'Herrería'
    case 'montajes-pa': return 'Mont PA'
    case 'montajes-ph': return 'Mont PH'
  }
}
