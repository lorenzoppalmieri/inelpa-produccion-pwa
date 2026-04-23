import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import { useSession } from '../context/SessionContext'
import { crearEvento, buscarDemoraAbierta, eventosDeEtapa } from '../db/eventos'
import type { CausaDemora, EtapaOrden, OrdenFabricacion, Evento, PuestoTrabajo } from '../types'
import CausaDemoraModal from '../components/CausaDemoraModal'
import ObservacionModal from '../components/ObservacionModal'
import PuestoSelectorModal from '../components/PuestoSelectorModal'

/**
 * Pantalla principal: operar sobre una etapa de trabajo.
 *
 * 4 acciones (botones grandes):
 *  - Iniciar proceso
 *  - Registrar demora (abre/cierra demora según corresponda)
 *  - Control de calidad (pide observación)
 *  - Finalizar proceso
 *
 * Muestra un timeline con los últimos eventos de esta etapa.
 */
export default function OperacionScreen() {
  const { etapaId } = useParams<{ etapaId: string }>()
  const navigate = useNavigate()
  const { operario } = useSession()

  const etapa = useLiveQuery(
    () => (etapaId ? db.etapas.get(etapaId) : undefined),
    [etapaId],
  )
  const orden = useLiveQuery(
    () => (etapa ? db.ordenes.get(etapa.orden_id) : undefined),
    [etapa?.orden_id],
  )
  const eventos = useLiveQuery(
    async () => (etapaId ? eventosDeEtapa(etapaId) : []),
    [etapaId],
  )

  const demoraAbierta = useLiveQuery(
    async () =>
      etapaId && operario ? buscarDemoraAbierta(etapaId, operario.id) : null,
    [etapaId, operario?.id],
  )

  const [modalCausa, setModalCausa] = useState(false)
  const [modalObs, setModalObs] = useState(false)
  const [modalPuesto, setModalPuesto] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  if (!operario || !etapaId) {
    navigate('/etapas', { replace: true })
    return null
  }
  if (etapa === undefined || eventos === undefined) {
    return <div className="p-8 text-slate-400">Cargando…</div>
  }
  if (etapa === null || !etapa) {
    return (
      <div className="p-8 text-slate-400">
        La etapa no existe o no está disponible.
        <button className="btn-secondary mt-4" onClick={() => navigate('/etapas')}>
          Volver
        </button>
      </div>
    )
  }

  // Reglas de qué botones se pueden usar según estado de la etapa
  const iniciado = etapa.estado === 'en_proceso' || etapa.estado === 'demorada'
  const puedeIniciar = etapa.estado === 'pendiente'
  const puedeFinalizar = etapa.estado === 'en_proceso' // no se finaliza si hay demora abierta

  const mostrarFlash = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 2500)
  }

  // Puesto que aplica a los eventos post-inicio. Prioridad:
  //  1. Puesto con el que se inició la etapa (etapa.puesto_trabajo_id)
  //  2. Puesto habitual del operario
  // Si el operario trabajó en una máquina distinta a la habitual y apretó
  // "Registrar demora", el evento debe reflejar la máquina real donde ocurrió.
  const puestoVigenteId = etapa.puesto_trabajo_id ?? operario.puesto_trabajo_id ?? null

  const onIniciar = () => {
    if (trabajando) return
    setModalPuesto(true)
  }

  const onPuestoConfirmado = async (puesto: PuestoTrabajo) => {
    setModalPuesto(false)
    setTrabajando(true)
    try {
      await crearEvento({
        etapa_orden_id: etapa.id,
        operario_id: operario.id,
        puesto_trabajo_id: puesto.id,
        tipo: 'INICIO',
      })
      await db.etapas.update(etapa.id, {
        estado: 'en_proceso',
        inicio_real_at: new Date().toISOString(),
        puesto_trabajo_id: puesto.id,
      })
      const esDistinto = puesto.id !== operario.puesto_trabajo_id
      mostrarFlash(
        esDistinto
          ? `Proceso iniciado en ${puesto.nombre}.`
          : 'Proceso iniciado.',
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
        etapa_orden_id: etapa.id,
        operario_id: operario.id,
        puesto_trabajo_id: puestoVigenteId,
        tipo: 'FIN',
      })
      await db.etapas.update(etapa.id, {
        estado: 'completada',
        fin_real_at: new Date().toISOString(),
      })
      mostrarFlash('Proceso finalizado.')
      setTimeout(() => navigate('/etapas', { replace: true }), 800)
    } finally {
      setTrabajando(false)
    }
  }

  const onDemora = async () => {
    if (trabajando) return
    if (demoraAbierta) {
      // Cerrar la demora
      setTrabajando(true)
      try {
        await crearEvento({
          etapa_orden_id: etapa.id,
          operario_id: operario.id,
          puesto_trabajo_id: puestoVigenteId,
          tipo: 'DEMORA_FIN',
          evento_demora_inicio_id: demoraAbierta.id,
        })
        await db.etapas.update(etapa.id, { estado: 'en_proceso' })
        mostrarFlash('Demora finalizada.')
      } finally {
        setTrabajando(false)
      }
    } else {
      // Abrir demora — pide causa
      setModalCausa(true)
    }
  }

  const onCausaSeleccionada = async (causa: CausaDemora, observacion: string | undefined) => {
    setModalCausa(false)
    setTrabajando(true)
    try {
      await crearEvento({
        etapa_orden_id: etapa.id,
        operario_id: operario.id,
        puesto_trabajo_id: puestoVigenteId,
        tipo: 'DEMORA_INICIO',
        causa_demora_codigo: causa.codigo,
        observacion,
      })
      await db.etapas.update(etapa.id, { estado: 'demorada' })
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
        etapa_orden_id: etapa.id,
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
      <HeaderEtapa
        etapa={etapa}
        orden={orden ?? null}
        puestoVigenteId={puestoVigenteId}
        onVolver={() => navigate('/etapas')}
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

      {/* Botones de acción */}
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

      {/* Timeline de eventos */}
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

function HeaderEtapa({
  etapa,
  orden,
  puestoVigenteId,
  onVolver,
}: {
  etapa: EtapaOrden
  orden: OrdenFabricacion | null
  puestoVigenteId: string | null
  onVolver: () => void
}) {
  const puesto = useLiveQuery(
    () => (puestoVigenteId ? db.puestos.get(puestoVigenteId) : undefined),
    [puestoVigenteId],
  )
  return (
    <header className="flex items-start justify-between gap-4 pb-3 border-b border-slate-700">
      <div>
        <div className="text-touch-xl font-bold text-inelpa-accent">
          {orden?.codigo ?? '(sin código)'}
        </div>
        {orden?.cliente && <div className="text-touch-base text-slate-300">{orden.cliente}</div>}
        {orden?.descripcion && (
          <div className="text-sm text-slate-400 mt-1 max-w-3xl">{orden.descripcion}</div>
        )}
        <div className="text-xs text-slate-500 mt-2">
          Sector {etapa.sector_codigo} · Secuencia {etapa.secuencia} · Estado {etapa.estado}
          {puesto && (
            <>
              {' '}· Puesto{' '}
              <span className="text-slate-300 font-semibold">{puesto.nombre}</span>
            </>
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
