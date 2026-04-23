-- =======================================================================
-- Inelpa · Registro de Producción — Esquema inicial
-- Fecha: 2026-04-22
--
-- Este archivo es IDEMPOTENTE: se puede correr muchas veces seguidas sin error.
-- Cada CREATE va precedido de su DROP ... IF EXISTS correspondiente.
-- =======================================================================

-- ------------------------------------------------------------------
-- LIMPIEZA PREVIA (para que el archivo sea re-ejecutable)
-- ------------------------------------------------------------------
drop view if exists v_demoras cascade;
drop table if exists eventos cascade;
drop table if exists etapas_orden cascade;
drop table if exists ordenes_fabricacion cascade;
drop table if exists causas_demora cascade;
drop table if exists operarios cascade;
drop table if exists puestos_trabajo cascade;
drop table if exists sectores cascade;
drop type if exists tipo_evento cascade;
drop type if exists estado_orden cascade;
drop type if exists estado_etapa cascade;
drop type if exists categoria_causa cascade;
drop type if exists sector_codigo cascade;
drop type if exists tipo_puesto cascade;
drop function if exists set_updated_at() cascade;

-- ------------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------------
create type sector_codigo as enum (
  'bobinado-at',
  'bobinado-bt',
  'herreria',
  'montajes-pa',
  'montajes-ph'
);

create type categoria_causa as enum (
  'ESPERA_MATERIAL',
  'ESPERA_HERRAMIENTA',
  'RETRABAJO',
  'EQUIPO',
  'CALIDAD',
  'PERSONAL',
  'EXTERNO',
  'OPERATIVA',
  'OTRO'
);

create type estado_etapa as enum (
  'pendiente',
  'en_proceso',
  'demorada',
  'completada'
);

create type estado_orden as enum (
  'pendiente',
  'en_proceso',
  'completada',
  'cancelada'
);

create type tipo_evento as enum (
  'INICIO',
  'FIN',
  'DEMORA_INICIO',
  'DEMORA_FIN',
  'CONTROL_CALIDAD'
);

create type tipo_puesto as enum (
  'maquina',
  'box',
  'equipo'
);

-- ------------------------------------------------------------------
-- CATÁLOGOS
-- ------------------------------------------------------------------

-- Sectores (5 entradas fijas, seedeadas)
create table sectores (
  codigo sector_codigo primary key,
  nombre text not null,
  orden_secuencia int not null, -- 1..5 para saber qué etapa viene después
  activo boolean not null default true
);

-- Puestos de trabajo (máquinas, boxes, equipos)
create table puestos_trabajo (
  id uuid primary key default gen_random_uuid(),
  sector_codigo sector_codigo not null references sectores(codigo),
  nombre text not null,
  tipo tipo_puesto not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index puestos_trabajo_sector_idx on puestos_trabajo(sector_codigo) where activo;

-- Operarios (autenticación por PIN)
create table operarios (
  id uuid primary key default gen_random_uuid(),
  pin int not null unique check (pin between 1000 and 9999),
  nombre text not null,
  apellido text not null,
  sector_codigo sector_codigo not null references sectores(codigo),
  puesto_trabajo_id uuid references puestos_trabajo(id), -- null = no asignado a puesto fijo
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index operarios_pin_idx on operarios(pin) where activo;
create index operarios_sector_idx on operarios(sector_codigo) where activo;

-- Catálogo global de causas de demora
create table causas_demora (
  codigo text primary key, -- formato DEM-001, DEM-002, etc.
  descripcion text not null,
  categoria categoria_causa not null,
  sectores_aplicables sector_codigo[] not null,
  activa boolean not null default true,
  notas text, -- observaciones internas para gestión del catálogo
  created_at timestamptz not null default now()
);
create index causas_activas_idx on causas_demora using gin(sectores_aplicables) where activa;

-- ------------------------------------------------------------------
-- ÓRDENES DE FABRICACIÓN Y ETAPAS
-- ------------------------------------------------------------------

-- Una orden recorre varias etapas (una por sector). Para el MVP se cargan
-- manualmente; luego vendrán desde SAP B1 vía sync.
create table ordenes_fabricacion (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique, -- código de SAP B1 u otro identificador
  descripcion text,
  cliente text,
  estado estado_orden not null default 'pendiente',
  fecha_entrega_estimada date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Etapa = paso de la orden por un sector (Bobinado, Herrería, etc.)
-- Para Montajes, una orden tiene dos etapas: montajes-pa y montajes-ph.
create table etapas_orden (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references ordenes_fabricacion(id) on delete cascade,
  sector_codigo sector_codigo not null references sectores(codigo),
  secuencia int not null, -- 1, 2, 3... orden de ejecución
  estado estado_etapa not null default 'pendiente',
  puesto_trabajo_id uuid references puestos_trabajo(id), -- se asigna al arrancar
  inicio_real_at timestamptz,
  fin_real_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (orden_id, sector_codigo) -- una etapa por sector por orden (MVP)
);
create index etapas_orden_sector_estado_idx on etapas_orden(sector_codigo, estado);
create index etapas_orden_orden_idx on etapas_orden(orden_id);

-- ------------------------------------------------------------------
-- EVENTOS DE PRODUCCIÓN
-- ------------------------------------------------------------------

-- Toda acción del operario queda como un evento. Es la tabla de hechos
-- y alimenta todos los reportes.
create table eventos (
  id uuid primary key, -- generado en cliente para consistencia offline
  etapa_orden_id uuid not null references etapas_orden(id) on delete cascade,
  operario_id uuid not null references operarios(id),
  puesto_trabajo_id uuid references puestos_trabajo(id),
  tipo tipo_evento not null,
  timestamp timestamptz not null default now(),

  -- Sólo aplica cuando tipo = 'DEMORA_INICIO'
  causa_demora_codigo text references causas_demora(codigo),

  -- Sólo aplica cuando tipo = 'DEMORA_FIN' — referencia al DEMORA_INICIO
  -- que cierra, para poder calcular duración
  evento_demora_inicio_id uuid references eventos(id),

  -- Observación libre (opcional en cualquier evento)
  observacion text,

  -- Metadata del cliente al crear el evento
  cliente_timestamp timestamptz not null, -- hora que marcaba el PC panel
  cliente_online boolean not null default true, -- ¿estaba con red al registrar?

  created_at timestamptz not null default now(),

  constraint evento_demora_coherente check (
    (tipo = 'DEMORA_INICIO' and causa_demora_codigo is not null)
    or (tipo = 'DEMORA_FIN' and evento_demora_inicio_id is not null)
    or (tipo not in ('DEMORA_INICIO', 'DEMORA_FIN'))
  )
);
create index eventos_etapa_idx on eventos(etapa_orden_id, timestamp);
create index eventos_operario_idx on eventos(operario_id, timestamp);
create index eventos_tipo_idx on eventos(tipo);

-- ------------------------------------------------------------------
-- TRIGGERS DE updated_at
-- ------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger operarios_updated_at before update on operarios
  for each row execute function set_updated_at();
create trigger ordenes_updated_at before update on ordenes_fabricacion
  for each row execute function set_updated_at();
create trigger etapas_updated_at before update on etapas_orden
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------------
-- La PWA usa la anon key. Todo pasa por estas políticas.
-- MVP: la anon key puede leer catálogos y escribir eventos; las escrituras
-- a órdenes/etapas/operarios se hacen desde el panel de administración
-- (service_role) hasta que agreguemos auth real.

alter table sectores enable row level security;
alter table puestos_trabajo enable row level security;
alter table operarios enable row level security;
alter table causas_demora enable row level security;
alter table ordenes_fabricacion enable row level security;
alter table etapas_orden enable row level security;
alter table eventos enable row level security;

-- Lectura libre para anon en catálogos (sectores, puestos, causas)
create policy "anon lee sectores" on sectores for select to anon using (activo);
create policy "anon lee puestos" on puestos_trabajo for select to anon using (activo);
create policy "anon lee causas" on causas_demora for select to anon using (activa);

-- Operarios: lee nombre/apellido/sector para validar PIN pero NO PINs de otros
-- (en la práctica el login hace un RPC server-side que devuelve solo datos del operario que matchea).
-- Por ahora para MVP permitimos lectura completa; cuando tengamos auth real cerramos.
create policy "anon lee operarios activos" on operarios for select to anon using (activo);

-- Órdenes y etapas: anon lee sólo las que están en curso o pendientes
create policy "anon lee ordenes activas" on ordenes_fabricacion for select to anon
  using (estado in ('pendiente', 'en_proceso'));
create policy "anon lee etapas activas" on etapas_orden for select to anon
  using (estado in ('pendiente', 'en_proceso', 'demorada'));
create policy "anon actualiza etapas (inicio/fin/puesto)" on etapas_orden for update to anon
  using (estado in ('pendiente', 'en_proceso', 'demorada'));

-- Eventos: anon puede insertar; lectura sólo de eventos recientes (24h)
-- para que la PWA pueda mostrar historial reciente sin exponer toda la tabla.
create policy "anon inserta eventos" on eventos for insert to anon
  with check (true);
create policy "anon lee eventos recientes" on eventos for select to anon
  using (created_at > now() - interval '24 hours');

-- ------------------------------------------------------------------
-- VISTAS ÚTILES (para reportes)
-- ------------------------------------------------------------------

-- Demoras con duración calculada (pareando DEMORA_INICIO con DEMORA_FIN)
create view v_demoras as
select
  i.id as demora_inicio_id,
  f.id as demora_fin_id,
  i.etapa_orden_id,
  i.operario_id,
  i.causa_demora_codigo,
  c.descripcion as causa_descripcion,
  c.categoria,
  i.timestamp as inicio_at,
  f.timestamp as fin_at,
  extract(epoch from (f.timestamp - i.timestamp)) / 60.0 as duracion_minutos,
  i.observacion
from eventos i
left join eventos f on f.evento_demora_inicio_id = i.id and f.tipo = 'DEMORA_FIN'
left join causas_demora c on c.codigo = i.causa_demora_codigo
where i.tipo = 'DEMORA_INICIO';

comment on view v_demoras is 'Demoras pareadas con duración. Si fin_at es null, la demora sigue abierta.';
