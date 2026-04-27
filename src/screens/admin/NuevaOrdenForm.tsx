import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import { supabase } from '../../lib/supabase'
import { syncCatalogos } from '../../db/syncCatalogos'
import type { ProductoTerminado } from '../../types'

/**
 * Form para crear órdenes de fabricación.
 *
 * El admin elige:
 *  - Código de la orden (manual o desde SAP B1)
 *  - Producto terminado (busca en el catálogo de 255 SKUs)
 *  - Cantidad de unidades
 *  - Cliente, fecha de entrega, prioridad
 *
 * Al confirmar:
 *  1. Se crea la orden en `ordenes_fabricacion` con producto_terminado_codigo y cantidad.
 *  2. Se llama a la función Postgres `expandir_bom_a_items(orden_id)` que
 *     genera automáticamente todos los items (3 BOBALT + 3 BOBBAJ + 1 cuba +
 *     1 tapa + 1 PA + 1 ensamble por unidad, según la BOM del PT).
 *  3. Se sincroniza Dexie para que el planificador los vea.
 */

interface Props {
  onCreada: () => void
}

export default function NuevaOrdenForm({ onCreada }: Props) {
  const productos = useLiveQuery(
    () => db.productosTerminados.toArray(),
    [],
    [] as ProductoTerminado[],
  )

  const [codigoOrden, setCodigoOrden] = useState('')
  const [productoCodigo, setProductoCodigo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [cliente, setCliente] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [prioridad, setPrioridad] = useState(100)
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  // Filtrado en cliente: el catálogo es chico (≤500 PTs) — un includes basta.
  const productosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return productos.slice(0, 50)
    const q = busqueda.toLowerCase()
    return productos
      .filter(
        (p) =>
          p.codigo.toLowerCase().includes(q) ||
          p.descripcion.toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [productos, busqueda])

  const productoSeleccionado = useMemo(
    () => productos.find((p) => p.codigo === productoCodigo) ?? null,
    [productos, productoCodigo],
  )

  // Cantidad de items que se van a generar (preview): 3+3+1+1+1+1=9 trif, 1+1+1+1+1+1=6 mono/bif
  const itemsAGenerar = useMemo(() => {
    if (!productoSeleccionado) return 0
    const porUnidad = productoSeleccionado.tipo === 'trifasico' ? 9 : 6
    return porUnidad * cantidad
  }, [productoSeleccionado, cantidad])

  const reset = () => {
    setCodigoOrden('')
    setProductoCodigo('')
    setBusqueda('')
    setCantidad(1)
    setCliente('')
    setFechaEntrega('')
    setPrioridad(100)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (trabajando) return

    const codigoLimpio = codigoOrden.trim()
    if (!codigoLimpio) {
      setMensaje({ tipo: 'error', texto: 'El código de la orden es obligatorio.' })
      return
    }
    if (!productoSeleccionado) {
      setMensaje({ tipo: 'error', texto: 'Elegí un producto terminado.' })
      return
    }
    if (cantidad < 1) {
      setMensaje({ tipo: 'error', texto: 'La cantidad debe ser al menos 1.' })
      return
    }

    setTrabajando(true)
    setMensaje(null)

    try {
      // 1) Crear la orden
      const { data: orden, error: errOrden } = await supabase
        .from('ordenes_fabricacion')
        .insert({
          codigo: codigoLimpio,
          descripcion: productoSeleccionado.descripcion,
          cliente: cliente.trim() || null,
          fecha_entrega_estimada: fechaEntrega || null,
          estado: 'pendiente',
          producto_terminado_codigo: productoSeleccionado.codigo,
          cantidad_unidades: cantidad,
          prioridad,
        })
        .select()
        .single()

      if (errOrden || !orden) {
        throw new Error(errOrden?.message ?? 'No se pudo crear la orden')
      }

      // 2) Expandir BOM → items (server-side via RPC)
      const { error: errExpand } = await supabase.rpc('expandir_bom_a_items', {
        p_orden_id: orden.id,
      })

      if (errExpand) {
        // Rollback manual
        await supabase.from('ordenes_fabricacion').delete().eq('id', orden.id)
        throw new Error(`No se pudo expandir la BOM: ${errExpand.message}`)
      }

      // 3) Sync Dexie para que aparezca en planificador / operarios
      await syncCatalogos()

      setMensaje({
        tipo: 'ok',
        texto: `Orden ${codigoLimpio} creada con ~${itemsAGenerar} items. Asignar puestos en el planificador.`,
      })
      reset()

      setTimeout(() => {
        setMensaje(null)
        onCreada()
      }, 1500)
    } catch (err) {
      const texto = err instanceof Error ? err.message : 'Error inesperado'
      setMensaje({ tipo: 'error', texto })
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <form onSubmit={submit} className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="space-y-4">
        <h2 className="text-touch-lg font-bold">Nueva orden de fabricación</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Campo label="Código *" hint="Ej: OF-2026-007">
            <input
              value={codigoOrden}
              onChange={(e) => setCodigoOrden(e.target.value.toUpperCase())}
              placeholder="OF-2026-007"
              required
              className="input"
            />
          </Campo>

          <Campo label="Cantidad de unidades *">
            <input
              type="number"
              min={1}
              max={100}
              value={cantidad}
              onChange={(e) => setCantidad(parseInt(e.target.value) || 1)}
              required
              className="input"
            />
          </Campo>

          <Campo label="Prioridad" hint="Menor = más urgente">
            <input
              type="number"
              min={1}
              max={999}
              value={prioridad}
              onChange={(e) => setPrioridad(parseInt(e.target.value) || 100)}
              className="input"
            />
          </Campo>
        </div>

        <Campo
          label="Producto terminado *"
          hint={`${productos.length} productos en catálogo`}
        >
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código o descripción…"
            className="input mb-2"
          />
          <div className="max-h-64 overflow-y-auto border border-slate-700 rounded-lg bg-slate-900">
            {productosFiltrados.length === 0 && (
              <div className="p-3 text-sm text-slate-500">
                Sin resultados. Probá otra búsqueda.
              </div>
            )}
            {productosFiltrados.map((p) => (
              <button
                key={p.codigo}
                type="button"
                onClick={() => setProductoCodigo(p.codigo)}
                className={`w-full text-left p-2 border-b border-slate-800 hover:bg-slate-800 ${
                  productoCodigo === p.codigo ? 'bg-amber-900/30 border-l-4 border-l-amber-500' : ''
                }`}
              >
                <div className="font-mono text-sm text-amber-400">{p.codigo}</div>
                <div className="text-xs text-slate-400 line-clamp-1">{p.descripcion}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {p.tipo} · {p.potencia_kva} kVA · {p.tension_kv} kV · {p.conductor}
                  {p.diseno_cuba && ` · ${p.diseno_cuba}`}
                  {p.lleva_tanque_expansion && ' · con tanque'}
                </div>
              </button>
            ))}
          </div>
        </Campo>

        {productoSeleccionado && (
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm">
            <div className="font-bold text-amber-400 mb-1">
              {productoSeleccionado.codigo}
            </div>
            <div className="text-slate-300">{productoSeleccionado.descripcion}</div>
            <div className="text-xs text-slate-400 mt-2">
              Esta orden generará{' '}
              <span className="font-bold text-emerald-400">{itemsAGenerar} items</span>{' '}
              ({productoSeleccionado.tipo === 'trifasico' ? '9' : '6'} por unidad ×{' '}
              {cantidad} {cantidad === 1 ? 'unidad' : 'unidades'}). Una vez creada, el
              planificador los asigna a puestos y operarios.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Cliente">
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Ej: EPEC"
              className="input"
            />
          </Campo>

          <Campo label="Fecha de entrega estimada">
            <input
              type="date"
              value={fechaEntrega}
              onChange={(e) => setFechaEntrega(e.target.value)}
              className="input"
            />
          </Campo>
        </div>
      </div>

      {mensaje && (
        <div
          className={`p-3 rounded-lg font-semibold ${
            mensaje.tipo === 'ok'
              ? 'bg-emerald-800 text-emerald-100 border border-emerald-600'
              : 'bg-red-900 text-red-100 border border-red-700'
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={reset}
          disabled={trabajando}
          className="btn-secondary !min-h-0 !py-3"
        >
          Limpiar
        </button>
        <button type="submit" disabled={trabajando} className="btn-primary !min-h-0 !py-3">
          {trabajando ? 'Creando…' : 'Crear orden y expandir BOM'}
        </button>
      </div>

      <style>{`
        .input {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          background-color: rgb(30 41 59);
          border: 1px solid rgb(71 85 105);
          color: rgb(241 245 249);
          font-size: 1rem;
        }
        .input:focus {
          outline: none;
          border-color: #f59e0b;
        }
        .input::placeholder {
          color: rgb(100 116 139);
        }
      `}</style>
    </form>
  )
}

function Campo({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-300">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}
