import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import { supabase } from '../../lib/supabase'
import { syncCatalogos } from '../../db/syncCatalogos'
import type {
  ItemOrden,
  OrdenFabricacion,
  PuestoTrabajo,
  Operario,
  Semielaborado,
  ProductoTerminado,
  SectorCodigo,
} from '../../types'

/**
 * Pantalla del planificador.
 *
 * Vista jerárquica: Órdenes → Items.
 *
 * Por cada item, el planificador define:
 *  - codigo_interno_fabricacion (clave para trazar bobinas)
 *  - puesto_trabajo_id
 *  - operario_id
 *  - inicio_planificado / fin_planificado
 *  - prioridad
 *
 * Soporta:
 *  - Edición inline por item (auto-save por campo)
 *  - Selección múltiple + asignación masiva (puesto + operario + fechas)
 *  - Filtros por sector y por orden
 *  - Resumen "X / Y items asignados" por orden
 *
 * Toda la edición pasa por Supabase y luego refresca Dexie.
 */

const SECTORES: { codigo: SectorCodigo; label: string }[] = [
  { codigo: 'bobinado-at', label: 'Bobinado AT' },
  { codigo: 'bobinado-bt', label: 'Bobinado BT' },
  { codigo: 'herreria', label: 'Herrería' },
  { codigo: 'montajes-pa', label: 'Montajes PA' },
  { codigo: 'montajes-ph', label: 'Montajes PH' },
]

type FiltroAsignacion = 'todos' | 'sin_asignar' | 'asignados'

export default function PlanificadorScreen() {
  const ordenes = useLiveQuery(
    () => db.ordenes.where('estado').anyOf('pendiente', 'en_proceso').toArray(),
    [],
    [] as OrdenFabricacion[],
  )
  const items = useLiveQuery(() => db.items.toArray(), [], [] as ItemOrden[])
  const puestos = useLiveQuery(() => db.puestos.toArray(), [], [] as PuestoTrabajo[])
  const operarios = useLiveQuery(() => db.operarios.toArray(), [], [] as Operario[])
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

  const [sectorFiltro, setSectorFiltro] = useState<SectorCodigo | 'all'>('all')
  const [ordenFiltro, setOrdenFiltro] = useState<string | 'all'>('all')
  const [asignFiltro, setAsignFiltro] = useState<FiltroAsignacion>('todos')
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const semiByCodigo = useMemo(
    () => new Map(semis.map((s) => [s.codigo, s])),
    [semis],
  )
  const ptByCodigo = useMemo(
    () => new Map(pts.map((p) => [p.codigo, p])),
    [pts],
  )
  const ordenById = useMemo(
    () => new Map(ordenes.map((o) => [o.id, o])),
    [ordenes],
  )

  // Filtrado en cliente: el dataset operativo es chico (≤500 items en curso)
  const itemsFiltrados = useMemo(() => {
    return items
      .filter((i) => {
        const orden = ordenById.get(i.orden_id)
        if (!orden) return false
        if (orden.estado === 'cancelada' || orden.estado === 'completada') return false
        if (i.estado === 'completada') return false
        if (sectorFiltro !== 'all' && i.sector_codigo !== sectorFiltro) return false
        if (ordenFiltro !== 'all' && i.orden_id !== ordenFiltro) return false
        if (asignFiltro === 'sin_asignar' && i.operario_id) return false
        if (asignFiltro === 'asignados' && !i.operario_id) return false
        return true
      })
      .sort((a, b) => {
        // Por orden (codigo) → unidad → sector → fase
        const oa = ordenById.get(a.orden_id)?.codigo ?? ''
        const ob = ordenById.get(b.orden_id)?.codigo ?? ''
        if (oa !== ob) return oa.localeCompare(ob)
        if (a.unidad_index !== b.unidad_index) return a.unidad_index - b.unidad_index
        if (a.sector_codigo !== b.sector_codigo)
          return a.sector_codigo.localeCompare(b.sector_codigo)
        return (a.fase ?? '').localeCompare(b.fase ?? '')
      })
  }, [items, ordenById, sectorFiltro, ordenFiltro, asignFiltro])

  // Agrupar por orden
  const itemsPorOrden = useMemo(() => {
    const map = new Map<string, ItemOrden[]>()
    for (const i of itemsFiltrados) {
      const arr = map.get(i.orden_id) ?? []
      arr.push(i)
      map.set(i.orden_id, arr)
    }
    return map
  }, [itemsFiltrados])

  const ordenesAMostrar = useMemo(
    () =>
      ordenes
        .filter(
          (o) =>
            (o.estado === 'pendiente' || o.estado === 'en_proceso') &&
            itemsPorOrden.has(o.id),
        )
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [ordenes, itemsPorOrden],
  )

  const totales = useMemo(() => {
    let asignados = 0
    let sinAsignar = 0
    for (const i of items) {
      const orden = ordenById.get(i.orden_id)
      if (!orden || orden.estado === 'cancelada' || orden.estado === 'completada') continue
      if (i.estado === 'completada') continue
      if (i.operario_id) asignados++
      else sinAsignar++
    }
    return { asignados, sinAsignar, total: asignados + sinAsignar }
  }, [items, ordenById])

  const limpiarMensaje = () => {
    setError(null)
    setInfo(null)
  }

  useEffect(() => {
    if (info || error) {
      const t = setTimeout(() => limpiarMensaje(), 3000)
      return () => clearTimeout(t)
    }
  }, [info, error])

  const actualizarItem = async (itemId: string, parche: Partial<ItemOrden>) => {
    setError(null)
    const { error: errU } = await supabase
      .from('items_orden')
      .update(parche)
      .eq('id', itemId)
    if (errU) {
      setError(`No se pudo guardar: ${errU.message}`)
      return false
    }
    await syncCatalogos()
    return true
  }

  const toggleSeleccion = (id: string) => {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev)
      if (nuevo.has(id)) nuevo.delete(id)
      else nuevo.add(id)
      return nuevo
    })
  }

  const toggleSeleccionTodos = (idsVisibles: string[]) => {
    setSeleccionados((prev) => {
      const todosSeleccionados = idsVisibles.every((id) => prev.has(id))
      const nuevo = new Set(prev)
      if (todosSeleccionados) {
        for (const id of idsVisibles) nuevo.delete(id)
      } else {
        for (const id of idsVisibles) nuevo.add(id)
      }
      return nuevo
    })
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-touch-lg font-bold">Planificador</h2>
          <p className="text-sm text-slate-400">
            Asigná puesto, operario y código interno a cada item. Los operarios
            verán los items asignados en su cola.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Pill color="emerald">{totales.asignados} asignados</Pill>
          <Pill color="amber">{totales.sinAsignar} sin asignar</Pill>
          <Pill color="slate">{totales.total} totales</Pill>
        </div>
      </header>

      {/* Filtros */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 flex flex-wrap items-center gap-3">
        <Selector
          label="Sector"
          value={sectorFiltro}
          onChange={(v) => setSectorFiltro(v as SectorCodigo | 'all')}
          options={[
            { value: 'all', label: 'Todos' },
            ...SECTORES.map((s) => ({ value: s.codigo, label: s.label })),
          ]}
        />
        <Selector
          label="Orden"
          value={ordenFiltro}
          onChange={(v) => setOrdenFiltro(v)}
          options={[
            { value: 'all', label: 'Todas' },
            ...ordenes
              .filter((o) => o.estado === 'pendiente' || o.estado === 'en_proceso')
              .map((o) => ({
                value: o.id,
                label: `${o.codigo}${
                  o.producto_terminado_codigo
                    ? ' · ' + o.producto_terminado_codigo
                    : ''
                }`,
              })),
          ]}
        />
        <Selector
          label="Asignación"
          value={asignFiltro}
          onChange={(v) => setAsignFiltro(v as FiltroAsignacion)}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'sin_asignar', label: 'Sin asignar' },
            { value: 'asignados', label: 'Asignados' },
          ]}
        />
        <button
          onClick={() => void syncCatalogos()}
          className="ml-auto px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
        >
          ↻ Refrescar
        </button>
      </div>

      {/* Mensajes */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900 text-red-100 border border-red-700">
          {error}
        </div>
      )}
      {info && (
        <div className="p-3 rounded-lg bg-emerald-900 text-emerald-100 border border-emerald-700">
          {info}
        </div>
      )}

      {/* Acciones masivas */}
      {seleccionados.size > 0 && (
        <AccionesMasivas
          seleccionados={Array.from(seleccionados)}
          puestos={puestos}
          operarios={operarios}
          onAplicado={(n) => {
            setSeleccionados(new Set())
            setInfo(`${n} item${n === 1 ? '' : 's'} actualizado${n === 1 ? '' : 's'}.`)
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {/* Listado por orden */}
      {ordenesAMostrar.length === 0 && (
        <div className="py-16 text-center text-slate-500">
          <p className="text-touch-base">
            No hay items que coincidan con los filtros.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {ordenesAMostrar.map((orden) => {
          const itemsDeOrden = itemsPorOrden.get(orden.id) ?? []
          const idsDeOrden = itemsDeOrden.map((i) => i.id)
          const todosSelDeOrden = idsDeOrden.every((id) => seleccionados.has(id))
          const algunoSelDeOrden = idsDeOrden.some((id) => seleccionados.has(id))
          const asignadosOrden = itemsDeOrden.filter((i) => i.operario_id).length
          const totalOrden = itemsDeOrden.length

          return (
            <div
              key={orden.id}
              className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden"
            >
              <div className="bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={todosSelDeOrden}
                    ref={(el) => {
                      if (el) el.indeterminate = !todosSelDeOrden && algunoSelDeOrden
                    }}
                    onChange={() => toggleSeleccionTodos(idsDeOrden)}
                    className="w-5 h-5 accent-amber-500"
                  />
                  <div>
                    <span className="text-touch-base font-bold text-inelpa-accent">
                      {orden.codigo}
                    </span>
                    {orden.producto_terminado_codigo && (
                      <span className="ml-3 text-sm font-mono text-slate-300">
                        {orden.producto_terminado_codigo} ×{' '}
                        {orden.cantidad_unidades}
                      </span>
                    )}
                    {orden.cliente && (
                      <span className="ml-3 text-sm text-slate-400">
                        {orden.cliente}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {asignadosOrden}/{totalOrden} asignados
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="p-2 w-10"></th>
                      <th className="p-2 text-left">Pieza</th>
                      <th className="p-2 text-left">Sector</th>
                      <th className="p-2 text-left">Cód. interno</th>
                      <th className="p-2 text-left">Puesto</th>
                      <th className="p-2 text-left">Operario</th>
                      <th className="p-2 text-left">Inicio plan.</th>
                      <th className="p-2 text-left">Fin plan.</th>
                      <th className="p-2 text-left">Prio</th>
                      <th className="p-2 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsDeOrden.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        seleccionado={seleccionados.has(item.id)}
                        onToggleSeleccion={() => toggleSeleccion(item.id)}
                        semi={
                          item.semielaborado_codigo
                            ? semiByCodigo.get(item.semielaborado_codigo)
                            : undefined
                        }
                        pt={
                          item.producto_terminado_codigo
                            ? ptByCodigo.get(item.producto_terminado_codigo)
                            : undefined
                        }
                        puestos={puestos.filter(
                          (p) => p.sector_codigo === item.sector_codigo,
                        )}
                        operarios={operarios.filter(
                          (o) => o.sector_codigo === item.sector_codigo,
                        )}
                        onUpdate={(parche) => actualizarItem(item.id, parche)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// -------------------------------------------------------------------
// Subcomponentes
// -------------------------------------------------------------------

function ItemRow({
  item,
  seleccionado,
  onToggleSeleccion,
  semi,
  pt,
  puestos,
  operarios,
  onUpdate,
}: {
  item: ItemOrden
  seleccionado: boolean
  onToggleSeleccion: () => void
  semi: Semielaborado | undefined
  pt: ProductoTerminado | undefined
  puestos: PuestoTrabajo[]
  operarios: Operario[]
  onUpdate: (parche: Partial<ItemOrden>) => Promise<boolean>
}) {
  const piezaCodigo =
    item.tipo === 'semielaborado'
      ? semi?.codigo ?? item.semielaborado_codigo ?? '(sin código)'
      : pt?.codigo ?? item.producto_terminado_codigo ?? '(ensamble)'

  const piezaDesc =
    item.tipo === 'semielaborado'
      ? semi?.descripcion ?? ''
      : pt?.descripcion ?? 'Ensamble final'

  const [codInterno, setCodInterno] = useState(item.codigo_interno_fabricacion ?? '')
  const [prioridad, setPrioridad] = useState(item.prioridad)
  const [inicio, setInicio] = useState(item.inicio_planificado ?? '')
  const [fin, setFin] = useState(item.fin_planificado ?? '')

  // Sincronizar estado local cuando cambian los datos del item desde Dexie.
  useEffect(() => {
    setCodInterno(item.codigo_interno_fabricacion ?? '')
    setPrioridad(item.prioridad)
    setInicio(item.inicio_planificado ?? '')
    setFin(item.fin_planificado ?? '')
  }, [
    item.codigo_interno_fabricacion,
    item.prioridad,
    item.inicio_planificado,
    item.fin_planificado,
  ])

  const guardarCampo = async (parche: Partial<ItemOrden>) => {
    await onUpdate(parche)
  }

  const badgeClases =
    item.estado === 'completada'
      ? 'bg-sky-700 text-white'
      : item.estado === 'en_proceso'
        ? 'bg-emerald-700 text-white'
        : item.estado === 'demorada'
          ? 'bg-red-700 text-white'
          : 'bg-slate-600 text-slate-100'

  const labelEstado =
    item.estado === 'completada'
      ? 'Completada'
      : item.estado === 'en_proceso'
        ? 'En proceso'
        : item.estado === 'demorada'
          ? 'Demorada'
          : 'Pendiente'

  const filaClase = item.operario_id
    ? 'border-b border-slate-700'
    : 'border-b border-slate-700 bg-amber-900/10'

  const editable = item.estado !== 'completada'

  return (
    <tr className={filaClase}>
      <td className="p-2 align-top">
        <input
          type="checkbox"
          checked={seleccionado}
          onChange={onToggleSeleccion}
          className="w-5 h-5 accent-amber-500"
          disabled={!editable}
        />
      </td>
      <td className="p-2 align-top">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-amber-400">
            {piezaCodigo}
          </span>
          {item.fase && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-violet-700 text-white">
              {item.fase}
            </span>
          )}
          {item.tipo === 'ensamble_final' && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-orange-700 text-white">
              ENSAMBLE
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-400 line-clamp-1">{piezaDesc}</div>
        <div className="text-[10px] text-slate-500">
          Unidad #{item.unidad_index}
        </div>
      </td>
      <td className="p-2 align-top text-xs text-slate-300">
        {labelSector(item.sector_codigo)}
      </td>
      <td className="p-2 align-top">
        <input
          value={codInterno}
          onChange={(e) => setCodInterno(e.target.value)}
          onBlur={() => {
            if (codInterno !== (item.codigo_interno_fabricacion ?? '')) {
              void guardarCampo({
                codigo_interno_fabricacion: codInterno.trim() || null,
              })
            }
          }}
          placeholder="(sin código)"
          disabled={!editable}
          className="w-32 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
        />
      </td>
      <td className="p-2 align-top">
        <select
          value={item.puesto_trabajo_id ?? ''}
          onChange={(e) =>
            void guardarCampo({
              puesto_trabajo_id: e.target.value || null,
            })
          }
          disabled={!editable}
          className="w-32 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100"
        >
          <option value="">(sin puesto)</option>
          {puestos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2 align-top">
        <select
          value={item.operario_id ?? ''}
          onChange={(e) =>
            void guardarCampo({
              operario_id: e.target.value || null,
            })
          }
          disabled={!editable}
          className="w-36 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100"
        >
          <option value="">(sin operario)</option>
          {operarios.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre} {o.apellido}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2 align-top">
        <input
          type="date"
          value={inicio?.slice(0, 10) ?? ''}
          onChange={(e) => setInicio(e.target.value)}
          onBlur={() => {
            const v = inicio || null
            if (v !== item.inicio_planificado) {
              void guardarCampo({ inicio_planificado: v })
            }
          }}
          disabled={!editable}
          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100"
        />
      </td>
      <td className="p-2 align-top">
        <input
          type="date"
          value={fin?.slice(0, 10) ?? ''}
          onChange={(e) => setFin(e.target.value)}
          onBlur={() => {
            const v = fin || null
            if (v !== item.fin_planificado) {
              void guardarCampo({ fin_planificado: v })
            }
          }}
          disabled={!editable}
          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100"
        />
      </td>
      <td className="p-2 align-top">
        <input
          type="number"
          min={1}
          max={999}
          value={prioridad}
          onChange={(e) => setPrioridad(parseInt(e.target.value) || 100)}
          onBlur={() => {
            if (prioridad !== item.prioridad) {
              void guardarCampo({ prioridad })
            }
          }}
          disabled={!editable}
          className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100"
        />
      </td>
      <td className="p-2 align-top">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClases}`}
        >
          {labelEstado}
        </span>
      </td>
    </tr>
  )
}

function AccionesMasivas({
  seleccionados,
  puestos,
  operarios,
  onAplicado,
  onError,
}: {
  seleccionados: string[]
  puestos: PuestoTrabajo[]
  operarios: Operario[]
  onAplicado: (n: number) => void
  onError: (msg: string) => void
}) {
  const [puestoId, setPuestoId] = useState('')
  const [operarioId, setOperarioId] = useState('')
  const [inicio, setInicio] = useState('')
  const [fin, setFin] = useState('')
  const [prioridad, setPrioridad] = useState<string>('')
  const [trabajando, setTrabajando] = useState(false)

  const aplicar = async () => {
    setTrabajando(true)
    const parche: Record<string, string | number | null> = {}
    if (puestoId === '__clear__') parche.puesto_trabajo_id = null
    else if (puestoId) parche.puesto_trabajo_id = puestoId

    if (operarioId === '__clear__') parche.operario_id = null
    else if (operarioId) parche.operario_id = operarioId

    if (inicio) parche.inicio_planificado = inicio
    if (fin) parche.fin_planificado = fin
    if (prioridad) parche.prioridad = parseInt(prioridad) || 100

    if (Object.keys(parche).length === 0) {
      onError('Seleccioná al menos un campo a aplicar.')
      setTrabajando(false)
      return
    }

    const { error } = await supabase
      .from('items_orden')
      .update(parche)
      .in('id', seleccionados)

    if (error) {
      onError(`Error al aplicar: ${error.message}`)
      setTrabajando(false)
      return
    }

    await syncCatalogos()
    setTrabajando(false)
    onAplicado(seleccionados.length)
    setPuestoId('')
    setOperarioId('')
    setInicio('')
    setFin('')
    setPrioridad('')
  }

  return (
    <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 space-y-3">
      <div className="text-sm font-semibold text-amber-200">
        Asignación masiva — {seleccionados.length} item
        {seleccionados.length === 1 ? '' : 's'} seleccionado
        {seleccionados.length === 1 ? '' : 's'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 items-end">
        <Campo label="Puesto">
          <select
            value={puestoId}
            onChange={(e) => setPuestoId(e.target.value)}
            className="input-sm"
          >
            <option value="">(no cambiar)</option>
            <option value="__clear__">— Quitar puesto —</option>
            {puestos.map((p) => (
              <option key={p.id} value={p.id}>
                {labelSector(p.sector_codigo)} · {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Operario">
          <select
            value={operarioId}
            onChange={(e) => setOperarioId(e.target.value)}
            className="input-sm"
          >
            <option value="">(no cambiar)</option>
            <option value="__clear__">— Quitar operario —</option>
            {operarios.map((o) => (
              <option key={o.id} value={o.id}>
                {labelSector(o.sector_codigo)} · {o.nombre} {o.apellido}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Inicio plan.">
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="input-sm"
          />
        </Campo>
        <Campo label="Fin plan.">
          <input
            type="date"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            className="input-sm"
          />
        </Campo>
        <Campo label="Prioridad">
          <input
            type="number"
            min={1}
            max={999}
            value={prioridad}
            onChange={(e) => setPrioridad(e.target.value)}
            placeholder="—"
            className="input-sm"
          />
        </Campo>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => void aplicar()}
          disabled={trabajando}
          className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-900 font-semibold text-sm"
        >
          {trabajando ? 'Aplicando…' : 'Aplicar a seleccionados'}
        </button>
      </div>
      <style>{`
        .input-sm {
          width: 100%;
          padding: 0.5rem;
          border-radius: 0.375rem;
          background-color: rgb(15 23 42);
          border: 1px solid rgb(71 85 105);
          color: rgb(241 245 249);
          font-size: 0.8rem;
        }
      `}</style>
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

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-amber-200 mb-1">{label}</span>
      {children}
    </label>
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

function labelSector(s: SectorCodigo): string {
  switch (s) {
    case 'bobinado-at': return 'Bob AT'
    case 'bobinado-bt': return 'Bob BT'
    case 'herreria': return 'Herrería'
    case 'montajes-pa': return 'Mont PA'
    case 'montajes-ph': return 'Mont PH'
  }
}
