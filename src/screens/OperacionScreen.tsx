import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import { useSession } from '../context/SessionContext'
import { crearEvento, buscarDemoraAbierta, eventosDeItem } from '../db/eventos'
import type {
  CausaDemora,
  ItemOrden,
  OrdenFabricacion,
  Evento,
  PuestoTrabajo,
  Semielaborado,
  ProductoTerminado,
} from '../types'
import CausaDemoraModal from '../components/CausaDemoraModal'
import ObservacionModal from '../components/ObservacionModal'
import PuestoSelectorModal from '../components/PuestoSelectorModal'

/**
 * Pantalla principal del operario: opera sobre un item asignado.
 *
 * 4 acciones (botones grandes):
 *  - Iniciar proceso
 *  - Registrar demora (abre/cierra demora según corresponda)
 *  - Control de calidad (pide observación)
 *  - Finalizar proceso
 *
 * Muestra un timeline con los últimos eventos de este item.
 */
export default function OperacionScreen() {
  const { itemId } = useParams<{ itemId: string }>()
  const navigate = useNavigate()
  const { operario } = useSession()

  const item = useLiveQuery(
    () => (itemId ? db.items.get(itemId) : undefined),
    [itemId],
  )
  const orden = useLiveQuery(
    () => (item ? db.ordenes.get(item.orden_id) : undefined),
    [item?.orden_id],
  )
  const semielaborado = useLiveQuery(
    () =>
      item?.semielaborado_codigo
        ? db.semielaborados.get(item.semielaborado_codigo)
        : undefined,
    [item?.semielaborado_codigo],
  )
  const productoTerminado = useLiveQuery(
    () =>
      item?.producto_terminado_codigo
        ? db.productosTerminados.get(item.producto_terminado_codigo)
        : undefined,
    [item?.producto_terminado_codigo],
  )
  const eventos = useLiveQuery(
    async () => (itemId ? eventosDeItem(itemId) : []),
    [itemId],
  )
  const demoraAbierta = useLiveQuery(
    async () =>
      itemId && operario ? buscarDemoraAbierta(itemId, operario.id) : null,
    [itemId, operario?.id],
  )

  const [modalCausa, setModalCausa] = useState(false)
  const [modalObs, setModalObs] = useState(false)
  const [modalPuesto, setModalPuesto] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  if (!operario || !itemId) {
    navigate('/cola', { replace: true })
    return null
  }
  if (item === undefined || eventos === undefined) {
    return <div className="p-8 text-slate-400">Cargando…</div>
  }
  if (item === null || !item) {
    return (
      <div className="p-8 text-slate-400">
        El item no existe o no está disponible.
        <button className="btn-secondary mt-4" onClick={() => navigate('/cola')}>
          Volver
        </button>
      </div>
    )
  }

  const iniciado = item.estado === 'en_proceso' || item.estado === 'demorada'
  const puedeIniciar = item.estado === 'pendiente'
  const puedeFinalizar = item.estado === 'en_proceso'

  const mostrarFlash = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 2500)
  }

  // Puesto vigente para los eventos:
  //  1. el puesto que el item ya tiene asignado (por planificador o por inicio previo)
  //  2. puesto habitual del operario (fallback)
  const puestoVigenteId = item.puesto_trabajo_id ?? operario.puesto_trabajo_id ?? null

  const onIniciar = () => {
    if (trabajando) return
    setModalPuesto(true)
  }

  const onPuestoConfirmado = async (puesto: PuestoTrabajo) => {
    setModalPuesto(false)
    setTrabajando(true)
    try {
      await crearEvento({
        item_orden_id: item.id,
        operario_id: operario.id,
        puesto_trabajo_id: puesto.id,
        tipo: 'INICIO',
      })
      // Si el item no tenía operario asignado, lo "tomamos" aquí.
      const update: Partial<ItemOrden> = {
        estado: 'en_proceso',
        inicio_real_at: new Date().toISOString(),
        puesto_trabajo_id: puesto.id,
      }
      if (!item.operario_id) update.operario_id = operario.id
      await db.items.update(item.id, update)
      const esDistinto = puesto.id !== operario.puesto_trabajo_id
      mostrarFlash(
        esDistinto ? `Proceso iniciado en ${puesto.nombre}.` : 'Proceso iniciado.',
      )
    } finally {
      setTrabajando(false)
    }
  }

  const onFinalizar = async () => {
    if (trabajando) return
    setTrabajando(true)
    try {
      await crearEvento({
        item_orden_id: item.id,
        operario_id: operario.id,
        puesto_trabajo_id: puestoVigenteId,
        tipo: 'FIN',
      })
      await db.items.update(item.id, {
        estado: 'completada',
        fin_real_at: new Date().toISOString(),
      })
      mostrarFlash('Proceso finalizado.')
      setTimeout(() => navigate('/cola', { replace: true }), 800)
    } finally {
      setTrabajando(false)
    }
  }

  const onDemora = async () => {
    if (trabajando) return
    if (demoraAbierta) {
      setTrabajando(true)
      try {
        await crearEvento({
          item_orden_id: item.id,
          operario_id: operario.id,
          puesto_trabajo_id: puestoVigenteId,
          tipo: 'DEMORA_FIN',
          evento_demora_inicio_id: demoraAbierta.id,
        })
        await db.items.update(item.id, { estado: 'en_proceso' })
        mostrarFlash('Demora finalizada.')
      } finally {
        setTrabajando(false)
      }
    } else {
      setModalCausa(true)
    }
  }

  const onCausaSeleccionada = async (
    causa: CausaDemora,
    observacion: string | undefined,
  ) => {
    setModalCausa(false)
    setTrabajando(true)
    try {
      await crearEvento({
        item_orden_id: item.id,
        operario_id: operario.id,
        puesto_trabajo_id: puestoVigenteId,
        tipo: 'DEMORA_INICIO',
        causa_demora_codigo: causa.codigo,
        observacion,
      })
      await db.items.update(item.id, { estado: 'demorada' })
      mostrarFlash(`Demora iniciada (${causa.codigo}).`)
    } finally {
      setTrabajando(false)
    }
  }

  const onCalidad = async (observacion: string) => {
    setModalObs(false)
    setTrabajando(true)
    try {
      await crearEvento({
        item_orden_id: item.id,
        operario_id: operario.id,
        puesto_trabajo_id: puestoVigenteId,
        tipo: 'CONTROL_CALIDAD',
        observacion,
      })
      mostrarFlash('Control de calidad registrado.')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="h-full p-6 flex flex-col gap-4">
      <HeaderItem
        item={item}
        orden={orden ?? null}
        semielaborado={semielaborado ?? null}
        productoTerminado={productoTerminado ?? null}
        puestoVigenteId={puestoVigenteId}
        onVolver={() => navigate('/cola')}
      />

      {flash && (
        <div className="bg-emerald-700 text-white px-4 py-2 rounded-lg font-semibold text-touch-base animate-pulse">
          {flash}
        </div>
      )}

      {demoraAbierta && (
        <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded-lg">
          <div className="font-bold text-touch-base">⚠ Demora en curso</div>
          <div className="text-sm">
            Iniciada a las{' '}
            {new Date(demoraAbierta.timestamp).toLocaleTimeString('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            — causa {demoraAbierta.causa_demora_codigo}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mt-2">
        <button
          className="btn-primary"
          disabled={!puedeIniciar || trabajando}
          onClick={onIniciar}
        >
          Iniciar proceso
        </button>
        <button
          className="btn-secondary"
          disabled={!iniciado || trabajando || !!demoraAbierta}
          onClick={() => setModalObs(true)}
        >
          Control de calidad
        </button>
        <button
          className="btn-danger"
          disabled={!iniciado || trabajando}
          onClick={onDemora}
        >
          {demoraAbierta ? 'Finalizar demora' : 'Registrar demora'}
        </button>
        <button
          className="btn-secondary"
          disabled={!puedeFinalizar || trabajando || !!demoraAbierta}
          onClick={onFinalizar}
        >
          Finalizar proceso
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mt-4">
        <h2 className="text-touch-base font-semibold text-slate-300 mb-2">
          Últimos eventos
        </h2>
        {eventos.length === 0 ? (
          <p className="text-slate-500 text-sm">Sin eventos registrados aún.</p>
        ) : (
          <ul className="space-y-1">
            {[...eventos].reverse().slice(0, 20).map((e) => (
              <TimelineItem key={e.id} evento={e} />
            ))}
          </ul>
        )}
      </div>

      {modalCausa && (
        <CausaDemoraModal
          sectorCodigo={operario.sector_codigo}
          onCancel={() => setModalCausa(false)}
          onConfirm={onCausaSeleccionada}
        />
      )}
      {modalObs && (
        <ObservacionModal
          titulo="Control de calidad"
          placeholder="Describí la observación de calidad…"
          onCancel={() => setModalObs(false)}
          onConfirm={onCalidad}
        />
      )}
      {modalPuesto && (
        <PuestoSelectorModal
          sectorCodigo={operario.sector_codigo}
          puestoHabitualId={operario.puesto_trabajo_id}
          onCancel={() => setModalPuesto(false)}
          onConfirm={onPuestoConfirmado}
        />
      )}
    </div>
  )
}

function HeaderItem({
  item,
  orden,
  semielaborado,
  productoTerminado,
  puestoVigenteId,
  onVolver,
}: {
  item: ItemOrden
  orden: OrdenFabricacion | null
  semielaborado: Semielaborado | null
  productoTerminado: ProductoTerminado | null
  puestoVigenteId: string | null
  onVolver: () => void
}) {
  const puesto = useLiveQuery(
    () => (puestoVigenteId ? db.puestos.get(puestoVigenteId) : undefined),
    [puestoVigenteId],
  )
  const piezaCodigo =
    item.tipo === 'semielaborado'
      ? semielaborado?.codigo ?? item.semielaborado_codigo
      : productoTerminado?.codigo ?? item.producto_terminado_codigo
  const piezaDesc =
    item.tipo === 'semielaborado'
      ? semielaborado?.descripcion
      : productoTerminado?.descripcion

  return (
    <header className="flex items-start justify-between gap-4 pb-3 border-b border-slate-700">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-touch-xl font-bold text-inelpa-accent">
            {piezaCodigo ?? '(pieza)'}
          </div>
          {item.fase && (
            <span className="text-sm font-bold px-2 py-0.5 rounded bg-violet-700 text-white">
              {item.fase}
            </span>
          )}
          {item.tipo === 'ensamble_final' && (
            <span className="text-sm font-bold px-2 py-0.5 rounded bg-orange-700 text-white">
              ENSAMBLE FINAL
            </span>
          )}
        </div>
        {piezaDesc && (
          <div className="text-touch-base text-slate-300 mt-1">{piezaDesc}</div>
        )}
        <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            Orden{' '}
            <span className="text-slate-300 font-semibold">
              {orden?.codigo ?? '—'}
            </span>
          </span>
          {orden?.cliente && <span>Cliente {orden.cliente}</span>}
          <span>
            Unidad {item.unidad_index}/{orden?.cantidad_unidades ?? '?'}
          </span>
          <span>Sector {item.sector_codigo}</span>
          <span>Estado {item.estado}</span>
          {puesto && (
            <span>
              Puesto{' '}
              <span className="text-slate-300 font-semibold">{puesto.nombre}</span>
            </span>
          )}
          {item.codigo_interno_fabricacion && (
            <span className="font-mono text-slate-400">
              {item.codigo_interno_fabricacion}
            </span>
          )}
        </div>
      </div>
      <button onClick={onVolver} className="btn-secondary !min-h-0 !py-2 !px-4 !text-base">
        ← Volver
      </button>
    </header>
  )
}

const LABEL_TIPO: Record<Evento['tipo'], string> = {
  INICIO: 'Inicio de proceso',
  FIN: 'Fin de proceso',
  DEMORA_INICIO: 'Inicio de demora',
  DEMORA_FIN: 'Fin de demora',
  CONTROL_CALIDAD: 'Control de calidad',
}

function TimelineItem({ evento }: { evento: Evento }) {
  const hora = new Date(evento.timestamp).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const color =
    evento.tipo === 'DEMORA_INICIO'
      ? 'text-red-400'
      : evento.tipo === 'DEMORA_FIN'
        ? 'text-amber-300'
        : evento.tipo === 'CONTROL_CALIDAD'
          ? 'text-sky-300'
          : 'text-emerald-300'
  const statusDot =
    evento.sync_status === 'synced'
      ? 'bg-emerald-500'
      : evento.sync_status === 'error'
        ? 'bg-red-500'
        : 'bg-amber-500'
  return (
    <li className="flex items-center gap-3 py-1 border-b border-slate-800 text-sm">
      <span className={`w-2 h-2 rounded-full ${statusDot}`} title={evento.sync_status} />
      <span className="text-slate-400 w-14">{hora}</span>
      <span className={`font-semibold ${color}`}>{LABEL_TIPO[evento.tipo]}</span>
      {evento.causa_demora_codigo && (
        <span className="text-slate-400">· {evento.causa_demora_codigo}</span>
      )}
      {evento.observacion && (
        <span className="text-slate-500 italic truncate">· {evento.observacion}</span>
      )}
    </li>
  )
}
