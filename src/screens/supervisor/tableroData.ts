import { supabase } from '../../lib/supabase'
import type {
  EstadoEtapa,
  EtapaOrden,
  OrdenFabricacion,
  PuestoTrabajo,
  Operario,
  SectorCodigo,
  TipoEvento,
} from '../../types'

/**
 * Estructura enriquecida que consume el tablero del supervisor.
 * Mantiene toda la info necesaria para pintar una tarjeta sin queries extra.
 */
export interface EtapaEnTablero {
  etapa: EtapaOrden
  orden: Pick<OrdenFabricacion, 'codigo' | 'cliente' | 'descripcion' | 'fecha_entrega_estimada'>
  puesto: Pick<PuestoTrabajo, 'nombre' | 'tipo'> | null
  operarioActual: Pick<Operario, 'nombre' | 'apellido'> | null
  // Derivados de eventos
  totalDemoras: number
  minutosEnEstado: number
  minutosTotalActivo: number
  demoraActiva: {
    inicio_at: string
    causa_codigo: string | null
    causa_descripcion: string | null
    minutos_abierta: number
    observacion: string | null
  } | null
  /** Último tipo de evento registrado (para color/resumen). */
  ultimoEventoTipo: TipoEvento | null
  ultimoEventoAt: string | null
}

// Forma cruda del resultado de Supabase (lo que pide el tablero vía joins).
interface EtapaRaw extends EtapaOrden {
  orden: OrdenFabricacion | null
  puesto: PuestoTrabajo | null
}

interface EventoRaw {
  id: string
  etapa_orden_id: string
  operario_id: string
  tipo: TipoEvento
  timestamp: string
  causa_demora_codigo: string | null
  evento_demora_inicio_id: string | null
  observacion: string | null
}

/**
 * Descarga todo lo necesario para pintar el tablero y lo arma.
 *
 * Hacemos 4 queries en paralelo (órdenes se unen con etapas vía FK):
 *  - etapas activas + orden + puesto (un solo select con relaciones)
 *  - eventos de esas etapas (para derivados)
 *  - operarios (para resolver el "operario actual" por último INICIO)
 *  - causas (para mostrar descripción de demora abierta)
 *
 * Filtros:
 *  - Por sector opcional (o 'all' para ver todo).
 *  - Solo etapas en estado pendiente/en_proceso/demorada (las completadas
 *    no interesan en un tablero en vivo).
 */
export async function cargarTablero(
  sector: SectorCodigo | 'all',
): Promise<EtapaEnTablero[]> {
  let etapasQuery = supabase
    .from('etapas_orden')
    .select(
      `
        *,
        orden:ordenes_fabricacion(codigo, cliente, descripcion, fecha_entrega_estimada, estado),
        puesto:puestos_trabajo(nombre, tipo)
      `,
    )
    .in('estado', ['pendiente', 'en_proceso', 'demorada'])

  if (sector !== 'all') {
    etapasQuery = etapasQuery.eq('sector_codigo', sector)
  }

  const { data: etapasRaw, error: errE } = await etapasQuery
  if (errE) throw errE
  const etapas = (etapasRaw ?? []) as unknown as EtapaRaw[]

  // Filtramos además órdenes canceladas (el estado de la etapa podría haber
  // quedado 'pendiente' pero la orden estar cancelada → no mostrar).
  const etapasVivas = etapas.filter(
    (e) => e.orden && e.orden.estado !== 'cancelada',
  )

  const etapaIds = etapasVivas.map((e) => e.id)
  if (etapaIds.length === 0) return []

  const [{ data: evs, error: errEv }, { data: opsAll, error: errOp }, { data: causas, error: errC }] =
    await Promise.all([
      supabase
        .from('eventos')
        .select('*')
        .in('etapa_orden_id', etapaIds)
        .order('timestamp', { ascending: true }),
      supabase.from('operarios').select('id, nombre, apellido'),
      supabase.from('causas_demora').select('codigo, descripcion'),
    ])

  if (errEv) throw errEv
  if (errOp) throw errOp
  if (errC) throw errC

  const eventos = (evs ?? []) as EventoRaw[]
  const operariosById = new Map((opsAll ?? []).map((o) => [o.id, o]))
  const causasByCodigo = new Map(
    (causas ?? []).map((c) => [c.codigo, c.descripcion as string]),
  )

  const ahora = Date.now()

  return etapasVivas.map((raw) => {
    const deEtapa = eventos.filter((ev) => ev.etapa_orden_id === raw.id)
    const demoraAbierta = encontrarDemoraAbierta(deEtapa)
    const totalDemoras = deEtapa.filter((ev) => ev.tipo === 'DEMORA_INICIO').length

    const ultimoInicio = [...deEtapa]
      .reverse()
      .find((ev) => ev.tipo === 'INICIO')

    const ultimoEvento = deEtapa[deEtapa.length - 1] ?? null

    const refEstado = momentoUltimoCambioEstado(raw.estado, deEtapa, raw.inicio_real_at)
    const minutosEnEstado = refEstado
      ? Math.max(0, Math.floor((ahora - new Date(refEstado).getTime()) / 60_000))
      : 0
    const minutosTotalActivo = raw.inicio_real_at
      ? Math.max(0, Math.floor((ahora - new Date(raw.inicio_real_at).getTime()) / 60_000))
      : 0

    const operarioId = ultimoInicio?.operario_id
    const op = operarioId ? operariosById.get(operarioId) : null

    return {
      etapa: raw as unknown as EtapaOrden,
      orden: {
        codigo: raw.orden!.codigo,
        cliente: raw.orden!.cliente,
        descripcion: raw.orden!.descripcion,
        fecha_entrega_estimada: raw.orden!.fecha_entrega_estimada,
      },
      puesto: raw.puesto
        ? { nombre: raw.puesto.nombre, tipo: raw.puesto.tipo }
        : null,
      operarioActual: op
        ? { nombre: op.nombre as string, apellido: op.apellido as string }
        : null,
      totalDemoras,
      minutosEnEstado,
      minutosTotalActivo,
      demoraActiva: demoraAbierta
        ? {
            inicio_at: demoraAbierta.timestamp,
            causa_codigo: demoraAbierta.causa_demora_codigo,
            causa_descripcion: demoraAbierta.causa_demora_codigo
              ? causasByCodigo.get(demoraAbierta.causa_demora_codigo) ?? null
              : null,
            minutos_abierta: Math.max(
              0,
              Math.floor((ahora - new Date(demoraAbierta.timestamp).getTime()) / 60_000),
            ),
            observacion: demoraAbierta.observacion,
          }
        : null,
      ultimoEventoTipo: ultimoEvento?.tipo ?? null,
      ultimoEventoAt: ultimoEvento?.timestamp ?? null,
    }
  })
}

/** Encuentra la demora más reciente sin cierre. */
function encontrarDemoraAbierta(eventos: EventoRaw[]): EventoRaw | null {
  const inicios = eventos
    .filter((e) => e.tipo === 'DEMORA_INICIO')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  for (const ini of inicios) {
    const cierre = eventos.find(
      (e) => e.tipo === 'DEMORA_FIN' && e.evento_demora_inicio_id === ini.id,
    )
    if (!cierre) return ini
  }
  return null
}

/**
 * Devuelve el ISO timestamp en el que la etapa entró al estado actual
 * (para calcular "tiempo en estado"). Heurística:
 *  - Si 'demorada': timestamp del DEMORA_INICIO abierto.
 *  - Si 'en_proceso': timestamp del último DEMORA_FIN, o del INICIO si no hubo demoras.
 *  - Si 'pendiente': null (nunca empezó).
 */
function momentoUltimoCambioEstado(
  estado: EstadoEtapa,
  eventos: EventoRaw[],
  inicioRealAt: string | null,
): string | null {
  if (estado === 'pendiente') return null
  if (estado === 'demorada') {
    const ini = encontrarDemoraAbierta(eventos)
    return ini?.timestamp ?? inicioRealAt
  }
  if (estado === 'en_proceso') {
    const ultimoFinDemora = [...eventos]
      .reverse()
      .find((e) => e.tipo === 'DEMORA_FIN')
    return ultimoFinDemora?.timestamp ?? inicioRealAt
  }
  return null
}

/** Formateo amigable "X min" / "Xh Ym" */
export function formatoMinutos(min: number): string {
  if (min < 1) return '<1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
