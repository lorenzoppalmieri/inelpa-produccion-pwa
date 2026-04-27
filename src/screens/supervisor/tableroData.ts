import { supabase } from '../../lib/supabase'
import type {
  EstadoEtapa,
  ItemOrden,
  OrdenFabricacion,
  PuestoTrabajo,
  Operario,
  Semielaborado,
  ProductoTerminado,
  SectorCodigo,
  TipoEvento,
  FaseBobina,
  TipoItem,
} from '../../types'

/**
 * Estructura enriquecida que consume el tablero del supervisor.
 * Mantiene toda la info necesaria para pintar una tarjeta sin queries extra.
 *
 * Tras el refactor a "items_orden", cada tarjeta corresponde a un item
 * (una bobina F1, una cuba, un ensamble, etc) — no a una etapa de sector
 * a nivel de orden completa.
 */
export interface ItemEnTablero {
  item: ItemOrden
  orden: Pick<
    OrdenFabricacion,
    'codigo' | 'cliente' | 'descripcion' | 'fecha_entrega_estimada' | 'cantidad_unidades'
  >
  pieza_codigo: string
  pieza_descripcion: string
  tipo: TipoItem
  fase: FaseBobina | null
  unidad_index: number
  codigo_interno_fabricacion: string | null
  puesto: Pick<PuestoTrabajo, 'nombre' | 'tipo'> | null
  operarioAsignado: Pick<Operario, 'nombre' | 'apellido'> | null
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

// Forma cruda del resultado de Supabase con joins.
interface ItemRaw extends ItemOrden {
  orden: OrdenFabricacion | null
  puesto: PuestoTrabajo | null
  operario: Operario | null
  semielaborado: Semielaborado | null
  producto_terminado: ProductoTerminado | null
}

interface EventoRaw {
  id: string
  item_orden_id: string
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
 * Hacemos queries en paralelo:
 *  - items activos + orden + puesto + operario + semielaborado + PT
 *  - eventos de esos items (para derivados)
 *  - causas (para mostrar descripción de demora abierta)
 *
 * Filtros:
 *  - Por sector opcional (o 'all' para ver todo).
 *  - Solo items en estado pendiente/en_proceso/demorada (las completadas
 *    no interesan en un tablero en vivo).
 */
export async function cargarTablero(
  sector: SectorCodigo | 'all',
): Promise<ItemEnTablero[]> {
  let q = supabase
    .from('items_orden')
    .select(
      `
        *,
        orden:ordenes_fabricacion(codigo, cliente, descripcion, fecha_entrega_estimada, estado, cantidad_unidades),
        puesto:puestos_trabajo(nombre, tipo),
        operario:operarios(nombre, apellido),
        semielaborado:semielaborados(codigo, descripcion),
        producto_terminado:productos_terminados(codigo, descripcion)
      `,
    )
    .in('estado', ['pendiente', 'en_proceso', 'demorada'])

  if (sector !== 'all') {
    q = q.eq('sector_codigo', sector)
  }

  const { data: itemsRaw, error: errI } = await q
  if (errI) throw errI
  const items = (itemsRaw ?? []) as unknown as ItemRaw[]

  // Filtramos órdenes canceladas/completadas (el item podría haber quedado
  // 'pendiente' pero la orden ya estar cerrada → no mostrar).
  const itemsVivos = items.filter(
    (i) =>
      i.orden &&
      i.orden.estado !== 'cancelada' &&
      i.orden.estado !== 'completada',
  )

  const itemIds = itemsVivos.map((i) => i.id)
  if (itemIds.length === 0) return []

  const [{ data: evs, error: errEv }, { data: causas, error: errC }] =
    await Promise.all([
      supabase
        .from('eventos')
        .select('*')
        .in('item_orden_id', itemIds)
        .order('timestamp', { ascending: true }),
      supabase.from('causas_demora').select('codigo, descripcion'),
    ])

  if (errEv) throw errEv
  if (errC) throw errC

  const eventos = (evs ?? []) as EventoRaw[]
  const causasByCodigo = new Map(
    (causas ?? []).map((c) => [c.codigo, c.descripcion as string]),
  )

  const ahora = Date.now()

  return itemsVivos.map((raw) => {
    const deItem = eventos.filter((ev) => ev.item_orden_id === raw.id)
    const demoraAbierta = encontrarDemoraAbierta(deItem)
    const totalDemoras = deItem.filter((ev) => ev.tipo === 'DEMORA_INICIO').length

    const ultimoEvento = deItem[deItem.length - 1] ?? null

    const refEstado = momentoUltimoCambioEstado(raw.estado, deItem, raw.inicio_real_at)
    const minutosEnEstado = refEstado
      ? Math.max(0, Math.floor((ahora - new Date(refEstado).getTime()) / 60_000))
      : 0
    const minutosTotalActivo = raw.inicio_real_at
      ? Math.max(0, Math.floor((ahora - new Date(raw.inicio_real_at).getTime()) / 60_000))
      : 0

    const piezaCodigo =
      raw.tipo === 'semielaborado'
        ? raw.semielaborado?.codigo ?? raw.semielaborado_codigo ?? '(sin código)'
        : raw.producto_terminado?.codigo ??
          raw.producto_terminado_codigo ??
          '(ensamble final)'

    const piezaDescripcion =
      raw.tipo === 'semielaborado'
        ? raw.semielaborado?.descripcion ?? ''
        : raw.producto_terminado?.descripcion ?? 'Ensamble final'

    return {
      item: raw as unknown as ItemOrden,
      orden: {
        codigo: raw.orden!.codigo,
        cliente: raw.orden!.cliente,
        descripcion: raw.orden!.descripcion,
        fecha_entrega_estimada: raw.orden!.fecha_entrega_estimada,
        cantidad_unidades: raw.orden!.cantidad_unidades,
      },
      pieza_codigo: piezaCodigo,
      pieza_descripcion: piezaDescripcion,
      tipo: raw.tipo,
      fase: raw.fase,
      unidad_index: raw.unidad_index,
      codigo_interno_fabricacion: raw.codigo_interno_fabricacion,
      puesto: raw.puesto
        ? { nombre: raw.puesto.nombre, tipo: raw.puesto.tipo }
        : null,
      operarioAsignado: raw.operario
        ? {
            nombre: raw.operario.nombre as string,
            apellido: raw.operario.apellido as string,
          }
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
              Math.floor(
                (ahora - new Date(demoraAbierta.timestamp).getTime()) / 60_000,
              ),
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
 * Devuelve el ISO timestamp en el que el item entró al estado actual
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
