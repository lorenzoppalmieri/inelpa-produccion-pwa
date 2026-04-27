-- =======================================================================
-- Inelpa · Registro de Producción — Modelo v2: items por orden
-- Fecha: 2026-04-26
--
-- Cambios respecto al modelo v1:
--   * Una orden de fabricación ahora se descompone en N items, uno por cada
--     semielaborado a producir (3 BOBALT + 3 BOBBAJ + 1 cuba + 1 tapa + ...).
--   * Cada item se asigna a un puesto (y opcionalmente a un operario) por
--     el planificador antes de empezar — el operario ya no elige libremente.
--   * Eventos ahora apuntan a items, no a "etapas de orden".
--   * Se agrega catálogo de productos terminados, semielaborados y BOM.
--
-- Nota: esta migración DROPEA etapas_orden y eventos.etapa_orden_id.
-- En el MVP los datos eran de prueba — al pasar a producción real el seed
-- viene desde SAP B1 / planificador.
-- =======================================================================

-- ------------------------------------------------------------------
-- LIMPIEZA PREVIA (idempotente)
-- ------------------------------------------------------------------
drop view if exists v_demoras cascade;
drop table if exists eventos cascade;
drop table if exists etapas_orden cascade;
drop table if exists items_orden cascade;
drop table if exists bom_productos cascade;
drop table if exists semielaborados cascade;
drop table if exists productos_terminados cascade;
drop function if exists sector_de_familia_se(text) cascade;
drop function if exists expandir_bom_a_items(uuid) cascade;
drop type if exists familia_pt cascade;
drop type if exists familia_se cascade;
drop type if exists tipo_transformador cascade;
drop type if exists tipo_item cascade;
drop type if exists fase_bobina cascade;

-- ------------------------------------------------------------------
-- ENUMS NUEVOS
-- ------------------------------------------------------------------

-- Familias de productos terminados (prefijo SAP B1)
create type familia_pt as enum (
  'TMR07V', 'TMR19V',         -- Transformador Monofásico Rural
  'TBR13V', 'TBR33V',         -- Transformador Bifásico Rural
  'TTR13V', 'TTR33V',         -- Transformador Trifásico Rural
  'TTD13V', 'TTD33V'          -- Transformador Trifásico Distribución
);

-- Familias de semielaborados (prefijo SAP B1)
create type familia_se as enum (
  'BOBALT',  -- Bobina AT       → bobinado-at
  'BOBBAJ',  -- Bobina BT       → bobinado-bt
  'CUBRUR',  -- Cuba rural      → herreria
  'CUBDIS',  -- Cuba distrib.   → herreria
  'TANDIS',  -- Tanque expans.  → herreria
  'TAPRUR',  -- Tapa rural      → herreria
  'TAPDIS',  -- Tapa distrib.   → herreria
  'PARRUR',  -- Parte activa rural → montajes-pa
  'PARDIS'   -- Parte activa distrib. → montajes-pa
);

create type tipo_transformador as enum ('monofasico', 'bifasico', 'trifasico');

-- Distingue items que son semielaborados (vienen de la BOM) del ensamble
-- final post-horno (montajes-ph, donde se une PA + cuba + tapa + tanque).
create type tipo_item as enum ('semielaborado', 'ensamble_final');

-- Fase del bobinado para trifásicos (NULL para monofásicos / bifásicos)
create type fase_bobina as enum ('F1', 'F2', 'F3');

-- ------------------------------------------------------------------
-- CATÁLOGO: PRODUCTOS TERMINADOS
-- ------------------------------------------------------------------
create table productos_terminados (
  codigo text primary key,                  -- ej: TTD13V0000001
  descripcion text not null,                -- "Trifasico Distribucion 16/13.2 kVA Cu"
  familia familia_pt not null,
  tipo tipo_transformador not null,         -- monofasico/bifasico/trifasico
  potencia_kva numeric(10,2) not null,
  tension_kv numeric(6,2) not null,
  conductor text not null check (conductor in ('CU','AL')),
  diseno_cuba text,                         -- 'Monoposte' / 'Plataforma' / null
  lleva_tanque_expansion boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index productos_terminados_familia_idx on productos_terminados(familia) where activo;
create index productos_terminados_tipo_idx on productos_terminados(tipo) where activo;

comment on table productos_terminados is
  'Maestro de transformadores que Inelpa fabrica (255 SKUs). Sincronizado con SAP B1.';

-- ------------------------------------------------------------------
-- CATÁLOGO: SEMIELABORADOS
-- ------------------------------------------------------------------
create table semielaborados (
  codigo text primary key,                  -- ej: BOBALT0000096
  descripcion text not null,
  familia familia_se not null,
  sector_codigo sector_codigo not null,     -- derivado de familia (ver función)
  -- Atributos comunes (los que no apliquen quedan NULL)
  potencia_kva numeric(10,2),
  tension_kv numeric(6,2),
  conductor text check (conductor in ('CU','AL')),
  -- Atributos específicos
  aplicacion text check (aplicacion in ('rural','distribucion')),  -- bobinas, partes activas
  tipo tipo_transformador,                  -- bobinas, partes activas
  diseno_cuba text,                         -- cubas: Monoposte/Plataforma
  variante text,                            -- tapas: 'Tanque Expansion'/'Llenado Integral'
  forma text,                               -- bobinas: 'redondo'/'rectangular'
  fase fase_bobina,                         -- bobinas trifásicas: F1/F2/F3
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index semielaborados_familia_idx on semielaborados(familia) where activo;
create index semielaborados_sector_idx on semielaborados(sector_codigo) where activo;

comment on table semielaborados is
  'Maestro de partes intermedias trackeadas (bobinas, cubas, tapas, tanques, partes activas). Sincronizado con SAP B1.';

-- ------------------------------------------------------------------
-- CATÁLOGO: BILL OF MATERIALS (BOM)
-- ------------------------------------------------------------------
-- Relación N:M entre PT y SE: qué semielaborados arma cada producto terminado,
-- en qué cantidad y con qué rol (fase para bobinas trifásicas).
create table bom_productos (
  id uuid primary key default gen_random_uuid(),
  producto_terminado_codigo text not null references productos_terminados(codigo) on delete cascade,
  semielaborado_codigo text not null references semielaborados(codigo),
  cantidad numeric(8,2) not null default 1 check (cantidad > 0),
  fase fase_bobina,                         -- sólo para bobinas trifásicas
  -- Una BOM no puede tener el mismo SE+fase repetido para un PT
  unique (producto_terminado_codigo, semielaborado_codigo, fase)
);
create index bom_pt_idx on bom_productos(producto_terminado_codigo);
create index bom_se_idx on bom_productos(semielaborado_codigo);

comment on table bom_productos is
  'Despiece: qué semielaborados componen cada producto terminado y en qué cantidad.';

-- ------------------------------------------------------------------
-- ACTUALIZAR ordenes_fabricacion: ahora referencia un PT
-- ------------------------------------------------------------------
alter table ordenes_fabricacion
  add column if not exists producto_terminado_codigo text references productos_terminados(codigo),
  add column if not exists cantidad_unidades int not null default 1 check (cantidad_unidades > 0),
  add column if not exists prioridad int not null default 100;

create index if not exists ordenes_pt_idx on ordenes_fabricacion(producto_terminado_codigo);

-- ------------------------------------------------------------------
-- ITEMS DE ORDEN (lo que reemplaza a etapas_orden)
-- ------------------------------------------------------------------
-- Cada item es UNA pieza física a fabricar: una bobina F1, una cuba, una
-- parte activa, un ensamble final. Se generan al expandir la BOM al crear
-- la orden, y el planificador les asigna puesto + operario.
create table items_orden (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references ordenes_fabricacion(id) on delete cascade,
  tipo tipo_item not null,

  -- Si tipo = 'semielaborado': apunta al SE; si tipo = 'ensamble_final': null
  semielaborado_codigo text references semielaborados(codigo),
  -- Si tipo = 'ensamble_final': apunta al PT directamente
  producto_terminado_codigo text references productos_terminados(codigo),

  -- Identifica qué unidad de la orden produce este item (1..cantidad_unidades).
  -- Si la orden es por 5 transformadores trifásicos, hay 5 conjuntos de 3 BOBALT,
  -- distinguidos por unidad_index = 1..5.
  unidad_index int not null default 1 check (unidad_index >= 1),

  -- Fase (sólo aplica a bobinas trifásicas: F1/F2/F3)
  fase fase_bobina,

  -- Código interno de fabricación que asigna el planificador para etiquetar
  -- físicamente la pieza (ej: "OP-2026-014-BAT-F1"). Único cuando se asigna.
  codigo_interno_fabricacion text unique,

  -- Sector destino (derivado del semielaborado o = montajes-ph para ensamble final)
  sector_codigo sector_codigo not null,

  -- Asignación (la hace el planificador antes de iniciar)
  puesto_trabajo_id uuid references puestos_trabajo(id),
  operario_id uuid references operarios(id),
  inicio_planificado timestamptz,
  fin_planificado timestamptz,

  -- Ejecución real (timestamps de los eventos INICIO/FIN)
  estado estado_etapa not null default 'pendiente',
  inicio_real_at timestamptz,
  fin_real_at timestamptz,

  prioridad int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Coherencia: o es semielaborado con SE no-null, o es ensamble_final con PT no-null
  constraint item_tipo_coherente check (
    (tipo = 'semielaborado' and semielaborado_codigo is not null and producto_terminado_codigo is null)
    or (tipo = 'ensamble_final' and producto_terminado_codigo is not null and semielaborado_codigo is null)
  )
);
create index items_orden_orden_idx on items_orden(orden_id);
create index items_orden_sector_estado_idx on items_orden(sector_codigo, estado);
create index items_orden_puesto_idx on items_orden(puesto_trabajo_id) where puesto_trabajo_id is not null;
create index items_orden_operario_idx on items_orden(operario_id) where operario_id is not null;

comment on table items_orden is
  'Cada pieza física a fabricar para una orden. Un trifásico genera 3 BOBALT+3 BOBBAJ+1 cuba+1 tapa+1 PA+1 ensamble = 9 items por unidad.';

-- ------------------------------------------------------------------
-- EVENTOS DE PRODUCCIÓN (refactor: ahora apuntan a item, no a etapa)
-- ------------------------------------------------------------------
create table eventos (
  id uuid primary key,                      -- generado en cliente (offline-first)
  item_orden_id uuid not null references items_orden(id) on delete cascade,
  operario_id uuid not null references operarios(id),
  puesto_trabajo_id uuid references puestos_trabajo(id),
  tipo tipo_evento not null,
  timestamp timestamptz not null default now(),

  causa_demora_codigo text references causas_demora(codigo),
  evento_demora_inicio_id uuid references eventos(id),
  observacion text,

  cliente_timestamp timestamptz not null,
  cliente_online boolean not null default true,
  created_at timestamptz not null default now(),

  constraint evento_demora_coherente check (
    (tipo = 'DEMORA_INICIO' and causa_demora_codigo is not null)
    or (tipo = 'DEMORA_FIN' and evento_demora_inicio_id is not null)
    or (tipo not in ('DEMORA_INICIO', 'DEMORA_FIN'))
  )
);
create index eventos_item_idx on eventos(item_orden_id, timestamp);
create index eventos_operario_idx on eventos(operario_id, timestamp);
create index eventos_tipo_idx on eventos(tipo);

-- ------------------------------------------------------------------
-- TRIGGERS de updated_at en items_orden
-- ------------------------------------------------------------------
create trigger items_orden_updated_at before update on items_orden
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------
-- FUNCIONES DE NEGOCIO
-- ------------------------------------------------------------------

-- Deriva el sector destino a partir del prefijo del semielaborado.
create or replace function sector_de_familia_se(fam familia_se)
returns sector_codigo language sql immutable as $$
  select case fam
    when 'BOBALT' then 'bobinado-at'::sector_codigo
    when 'BOBBAJ' then 'bobinado-bt'::sector_codigo
    when 'CUBRUR' then 'herreria'::sector_codigo
    when 'CUBDIS' then 'herreria'::sector_codigo
    when 'TANDIS' then 'herreria'::sector_codigo
    when 'TAPRUR' then 'herreria'::sector_codigo
    when 'TAPDIS' then 'herreria'::sector_codigo
    when 'PARRUR' then 'montajes-pa'::sector_codigo
    when 'PARDIS' then 'montajes-pa'::sector_codigo
  end
$$;

-- Expande la BOM de una orden en N items, uno por cada (SE × unidad_index)
-- + 1 ensamble final por unidad. Se llama al crear la orden o al replanificar.
-- Idempotente: si ya hay items para la orden, los borra y los regenera.
create or replace function expandir_bom_a_items(p_orden_id uuid)
returns int language plpgsql as $$
declare
  v_pt_codigo text;
  v_cantidad int;
  v_count int := 0;
begin
  select producto_terminado_codigo, cantidad_unidades
    into v_pt_codigo, v_cantidad
  from ordenes_fabricacion
  where id = p_orden_id;

  if v_pt_codigo is null then
    raise exception 'La orden % no tiene producto_terminado_codigo asignado', p_orden_id;
  end if;

  -- Limpiar items previos (replanificación)
  delete from items_orden where orden_id = p_orden_id;

  -- Generar items de semielaborados, una vez por (BOM × unidad)
  insert into items_orden (
    orden_id, tipo, semielaborado_codigo, unidad_index, fase, sector_codigo
  )
  select
    p_orden_id,
    'semielaborado'::tipo_item,
    bom.semielaborado_codigo,
    u.unidad_index,
    bom.fase,
    se.sector_codigo
  from bom_productos bom
    join semielaborados se on se.codigo = bom.semielaborado_codigo
    cross join generate_series(1, v_cantidad) as u(unidad_index)
  where bom.producto_terminado_codigo = v_pt_codigo;

  get diagnostics v_count = row_count;

  -- Generar 1 ensamble final por unidad
  insert into items_orden (
    orden_id, tipo, producto_terminado_codigo, unidad_index, sector_codigo
  )
  select
    p_orden_id,
    'ensamble_final'::tipo_item,
    v_pt_codigo,
    u.unidad_index,
    'montajes-ph'::sector_codigo
  from generate_series(1, v_cantidad) as u(unidad_index);

  return v_count + v_cantidad;
end;
$$;

comment on function expandir_bom_a_items is
  'Genera los items de una orden a partir de su BOM. Idempotente. Devuelve total de items creados.';

-- ------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------------
alter table productos_terminados enable row level security;
alter table semielaborados enable row level security;
alter table bom_productos enable row level security;
alter table items_orden enable row level security;
alter table eventos enable row level security;

-- Catálogo de productos: lectura libre para anon (la PWA los muestra al planificador)
create policy "anon lee productos terminados" on productos_terminados
  for select to anon using (activo);
create policy "anon lee semielaborados" on semielaborados
  for select to anon using (activo);
create policy "anon lee bom" on bom_productos
  for select to anon using (true);

-- Items de orden: anon lee/inserta/actualiza (admin/planificador en UI por PIN)
create policy "anon lee items orden" on items_orden
  for select to anon using (estado in ('pendiente','en_proceso','demorada','completada'));
create policy "anon crea items orden" on items_orden
  for insert to anon with check (true);
create policy "anon actualiza items orden" on items_orden
  for update to anon using (estado in ('pendiente','en_proceso','demorada'));

-- Eventos: anon inserta + lee recientes (24h)
create policy "anon inserta eventos" on eventos
  for insert to anon with check (true);
create policy "anon lee eventos recientes" on eventos
  for select to anon using (created_at > now() - interval '24 hours');

-- ------------------------------------------------------------------
-- VISTAS ÚTILES
-- ------------------------------------------------------------------

-- Demoras pareadas (versión actualizada apuntando a items)
create view v_demoras as
select
  i.id as demora_inicio_id,
  f.id as demora_fin_id,
  i.item_orden_id,
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

comment on view v_demoras is 'Demoras pareadas con duración. Si fin_at es null, sigue abierta.';

-- Cola de trabajo por sector (lo que el operario ve al loguearse)
create view v_cola_sector as
select
  i.id as item_id,
  i.sector_codigo,
  i.puesto_trabajo_id,
  pt.nombre as puesto_nombre,
  i.operario_id,
  i.codigo_interno_fabricacion,
  i.estado,
  i.prioridad,
  i.unidad_index,
  i.fase,
  o.codigo as orden_codigo,
  o.cliente,
  case
    when i.tipo = 'semielaborado' then se.descripcion
    else pt2.descripcion
  end as descripcion,
  case
    when i.tipo = 'semielaborado' then se.codigo
    else pt2.codigo
  end as codigo_pieza,
  i.inicio_planificado,
  i.fin_planificado
from items_orden i
  join ordenes_fabricacion o on o.id = i.orden_id
  left join puestos_trabajo pt on pt.id = i.puesto_trabajo_id
  left join semielaborados se on se.codigo = i.semielaborado_codigo
  left join productos_terminados pt2 on pt2.codigo = i.producto_terminado_codigo
where i.estado in ('pendiente','en_proceso','demorada')
order by i.prioridad asc, i.inicio_planificado asc nulls last;

comment on view v_cola_sector is 'Vista que usa la PWA del operario para mostrar su cola de trabajo.';
