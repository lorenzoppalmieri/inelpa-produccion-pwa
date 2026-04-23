/**
 * Tipos del dominio de Inelpa · Registro de Producción.
 * Mantener sincronizado con el esquema SQL en supabase/migrations/.
 */

// -----------------------------------------------------------------
// Enums — siempre mantenerlos idénticos al SQL
// -----------------------------------------------------------------

export type SectorCodigo =
  | 'bobinado-at'
  | 'bobinado-bt'
  | 'herreria'
  | 'montajes-pa'
  | 'montajes-ph'

export type CategoriaCausa =
  | 'ESPERA_MATERIAL'
  | 'ESPERA_HERRAMIENTA'
  | 'RETRABAJO'
  | 'EQUIPO'
  | 'CALIDAD'
  | 'PERSONAL'
  | 'EXTERNO'
  | 'OPERATIVA'
  | 'OTRO'

export type EstadoEtapa =
  | 'pendiente'
  | 'en_proceso'
  | 'demorada'
  | 'completada'

export type EstadoOrden =
  | 'pendiente'
  | 'en_proceso'
  | 'completada'
  | 'cancelada'

export type TipoEvento =
  | 'INICIO'
  | 'FIN'
  | 'DEMORA_INICIO'
  | 'DEMORA_FIN'
  | 'CONTROL_CALIDAD'

export type TipoPuesto = 'maquina' | 'box' | 'equipo'

export type SyncStatus = 'pending' | 'synced' | 'error'

// -----------------------------------------------------------------
// Entidades
// -----------------------------------------------------------------

export interface Sector {
  codigo: SectorCodigo
  nombre: string
  orden_secuencia: number
  activo: boolean
}

export interface PuestoTrabajo {
  id: string
  sector_codigo: SectorCodigo
  nombre: string
  tipo: TipoPuesto
  activo: boolean
}

export interface Operario {
  id: string
  pin: number
  nombre: string
  apellido: string
  sector_codigo: SectorCodigo
  puesto_trabajo_id: string | null
  activo: boolean
}

export interface CausaDemora {
  codigo: string // 'DEM-001'
  descripcion: string
  categoria: CategoriaCausa
  sectores_aplicables: SectorCodigo[]
  activa: boolean
  notas?: string
}

export interface OrdenFabricacion {
  id: string
  codigo: string
  descripcion: string | null
  cliente: string | null
  estado: EstadoOrden
  fecha_entrega_estimada: string | null // ISO date
}

export interface EtapaOrden {
  id: string
  orden_id: string
  sector_codigo: SectorCodigo
  secuencia: number
  estado: EstadoEtapa
  puesto_trabajo_id: string | null
  inicio_real_at: string | null // ISO timestamp
  fin_real_at: string | null
}

/**
 * Evento es el registro de hecho: todo lo que hace un operario queda acá.
 * El `id` se genera en el cliente (UUID v4) para consistencia offline.
 */
export interface Evento {
  id: string
  etapa_orden_id: string
  operario_id: string
  puesto_trabajo_id: string | null
  tipo: TipoEvento
  timestamp: string // ISO — hora real del PC panel al crear el evento

  /** Sólo aplica cuando tipo = 'DEMORA_INICIO' */
  causa_demora_codigo?: string

  /** Sólo aplica cuando tipo = 'DEMORA_FIN' — referencia al DEMORA_INICIO que cierra */
  evento_demora_inicio_id?: string

  observacion?: string
  cliente_timestamp: string
  cliente_online: boolean

  // Campos locales (no van a Supabase, viven sólo en Dexie)
  sync_status: SyncStatus
  sync_error?: string
  sync_attempted_at?: string
}

// -----------------------------------------------------------------
// Tipos compuestos / convenientes para UI
// -----------------------------------------------------------------

/** Etapa + datos de la orden, para listas de trabajo */
export interface EtapaConOrden extends EtapaOrden {
  orden: Pick<OrdenFabricacion, 'codigo' | 'descripcion' | 'cliente'>
}

/** Demora pareada (vista v_demoras en Postgres) */
export interface DemoraPareada {
  demora_inicio_id: string
  demora_fin_id: string | null
  etapa_orden_id: string
  operario_id: string
  causa_demora_codigo: string
  causa_descripcion: string
  categoria: CategoriaCausa
  inicio_at: string
  fin_at: string | null
  duracion_minutos: number | null
  observacion: string | null
}
