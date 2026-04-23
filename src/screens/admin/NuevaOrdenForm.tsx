import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import { supabase } from '../../lib/supabase'
import { syncCatalogos } from '../../db/syncCatalogos'
import type { SectorCodigo, Sector } from '../../types'

/**
 * Form para crear manualmente una orden de fabricación mientras no
 * tengamos la ingesta desde SAP B1.
 *
 * Flujo:
 *  1. Datos de la orden (código, descripción, cliente, fecha entrega).
 *  2. Selección de qué sectores aplican para esta orden (con secuencia).
 *  3. Al confirmar: insert de la orden + insert bulk de etapas, una por
 *     sector elegido. La secuencia es el orden en que aparecen en la UI.
 *
 * Todo se hace contra Supabase con la anon key; las RLS de 0002 permiten
 * inserts desde anon. Tras crear, refrescamos catálogos locales (Dexie)
 * para que se vea en la PWA de los operarios sin esperar al loop de sync.
 */

// Todos los sectores del proceso en el orden "típico" de fabricación de
// un transformador. El admin puede desmarcar los que no apliquen y
// reordenar via los botones ↑ ↓.
const SECTOR_POR_DEFECTO: { codigo: SectorCodigo; label: string }[] = [
  { codigo: 'bobinado-at', label: 'Bobinado AT' },
  { codigo: 'bobinado-bt', label: 'Bobinado BT' },
  { codigo: 'herreria', label: 'Herrería' },
  { codigo: 'montajes-pa', label: 'Montajes PA (pre-horno)' },
  { codigo: 'montajes-ph', label: 'Montajes PH (post-horno)' },
]

interface SectorSel {
  codigo: SectorCodigo
  label: string
  activo: boolean
}

interface Props {
  onCreada: () => void
}

export default function NuevaOrdenForm({ onCreada }: Props) {
  const sectoresDisponibles = useLiveQuery<Sector[]>(
    () => db.sectores.toArray(),
    [],
    [],
  )

  const [codigo, setCodigo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [cliente, setCliente] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [sectores, setSectores] = useState<SectorSel[]>(
    SECTOR_POR_DEFECTO.map((s) => ({ ...s, activo: true })),
  )
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  // Si Dexie trae labels reales del catálogo, usarlos (p.ej. si el nombre
  // del sector cambió en la tabla).
  const labelPara = (codigo: SectorCodigo): string => {
    const real = sectoresDisponibles.find((s) => s.codigo === codigo)
    return real?.nombre ?? SECTOR_POR_DEFECTO.find((s) => s.codigo === codigo)?.label ?? codigo
  }

  const toggleSector = (codigo: SectorCodigo) => {
    setSectores((prev) =>
      prev.map((s) => (s.codigo === codigo ? { ...s, activo: !s.activo } : s)),
    )
  }

  const mover = (index: number, delta: -1 | 1) => {
    setSectores((prev) => {
      const nuevo = [...prev]
      const target = index + delta
      if (target < 0 || target >= nuevo.length) return prev
      ;[nuevo[index], nuevo[target]] = [nuevo[target], nuevo[index]]
      return nuevo
    })
  }

  const reset = () => {
    setCodigo('')
    setDescripcion('')
    setCliente('')
    setFechaEntrega('')
    setSectores(SECTOR_POR_DEFECTO.map((s) => ({ ...s, activo: true })))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (trabajando) return

    const codigoLimpio = codigo.trim()
    if (!codigoLimpio) {
      setMensaje({ tipo: 'error', texto: 'El código de la orden es obligatorio.' })
      return
    }
    const sectoresActivos = sectores.filter((s) => s.activo)
    if (sectoresActivos.length === 0) {
      setMensaje({ tipo: 'error', texto: 'Seleccioná al menos un sector.' })
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
          descripcion: descripcion.trim() || null,
          cliente: cliente.trim() || null,
          fecha_entrega_estimada: fechaEntrega || null,
          estado: 'pendiente',
        })
        .select()
        .single()

      if (errOrden || !orden) {
        throw new Error(errOrden?.message ?? 'No se pudo crear la orden')
      }

      // 2) Crear las etapas (una por sector seleccionado)
      const etapas = sectoresActivos.map((s, idx) => ({
        orden_id: orden.id,
        sector_codigo: s.codigo,
        secuencia: idx + 1,
        estado: 'pendiente' as const,
      }))
      const { error: errEtapas } = await supabase.from('etapas_orden').insert(etapas)

      if (errEtapas) {
        // Rollback manual: borramos la orden para no dejar basura.
        await supabase.from('ordenes_fabricacion').delete().eq('id', orden.id)
        throw new Error(`No se pudieron crear las etapas: ${errEtapas.message}`)
      }

      // 3) Refrescar catálogos locales para que los operarios la vean ya
      await syncCatalogos()

      setMensaje({ tipo: 'ok', texto: `Orden ${codigoLimpio} creada con ${etapas.length} etapas.` })
      reset()

      // Saltamos a la tab de listado después de un breve delay
      setTimeout(() => {
        setMensaje(null)
        onCreada()
      }, 1200)
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
        <h2 className="text-touch-lg font-bold">Datos de la orden</h2>

        <Campo label="Código *" hint="Formato: OF-AAAA-NNN (ej: OF-2026-007)">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="OF-2026-007"
            required
            className="input"
          />
        </Campo>

        <Campo label="Descripción">
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            placeholder="Ej: Transformador 500 KVA 13.2/0.4 kV"
            className="input"
          />
        </Campo>

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

      <div className="space-y-3">
        <h2 className="text-touch-lg font-bold">Etapas / sectores</h2>
        <p className="text-sm text-slate-400">
          Elegí por qué sectores pasa esta orden. La secuencia de arriba hacia abajo
          es el orden en que se ejecutan.
        </p>

        <ul className="space-y-2">
          {sectores.map((s, idx) => (
            <li
              key={s.codigo}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                s.activo
                  ? 'bg-slate-800 border-slate-600'
                  : 'bg-slate-900 border-slate-800 opacity-60'
              }`}
            >
              <label className="flex items-center gap-3 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.activo}
                  onChange={() => toggleSector(s.codigo)}
                  className="w-5 h-5 accent-inelpa-accent"
                />
                <span className="text-touch-base font-semibold">{labelPara(s.codigo)}</span>
                <span className="text-xs text-slate-500">({s.codigo})</span>
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => mover(idx, -1)}
                  disabled={idx === 0}
                  className="w-10 h-10 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-xl"
                  title="Subir"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => mover(idx, 1)}
                  disabled={idx === sectores.length - 1}
                  className="w-10 h-10 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-xl"
                  title="Bajar"
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
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
          {trabajando ? 'Creando…' : 'Crear orden'}
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
