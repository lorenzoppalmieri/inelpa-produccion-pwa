-- =======================================================================
-- Inelpa · Producción — Seed real de puestos de trabajo
-- Fecha: 2026-04-22
--
-- Reemplaza los puestos del seed inicial por el catálogo real de planta:
--   · Bobinado AT: 20 máquinas
--   · Bobinado BT: 10 máquinas
--   · Herrería:    10 boxes + 6 máquinas especiales
--   · Montajes PA / PH: un "equipo" por sector (trabajo por cuadrilla)
--
-- Este archivo es IDEMPOTENTE: antes de borrar los puestos viejos, limpia
-- las referencias en operarios / etapas_orden / eventos. Seguro de correr
-- en cualquier estado de la base.
-- =======================================================================

-- 1) Limpiar referencias a los puestos actuales
update operarios      set puesto_trabajo_id = null where puesto_trabajo_id is not null;
update etapas_orden   set puesto_trabajo_id = null where puesto_trabajo_id is not null;
update eventos        set puesto_trabajo_id = null where puesto_trabajo_id is not null;

-- 2) Vaciar la tabla
delete from puestos_trabajo;

-- 3) Bobinado AT — 20 máquinas
insert into puestos_trabajo (sector_codigo, nombre, tipo, activo)
select 'bobinado-at', 'MAQ. BOB. A.T. N°' || n, 'maquina', true
from generate_series(1, 20) n;

-- 4) Bobinado BT — 10 máquinas
insert into puestos_trabajo (sector_codigo, nombre, tipo, activo)
select 'bobinado-bt', 'MAQ. BOB. B.T. N°' || n, 'maquina', true
from generate_series(1, 10) n;

-- 5) Herrería — 10 boxes
insert into puestos_trabajo (sector_codigo, nombre, tipo, activo)
select 'herreria', 'BOX N°' || n, 'box', true
from generate_series(1, 10) n;

-- 6) Herrería — máquinas especiales
insert into puestos_trabajo (sector_codigo, nombre, tipo, activo) values
  ('herreria', 'MAQUINA PLEGADORA',                     'maquina', true),
  ('herreria', 'MAQUINA CORTE LASER',                   'maquina', true),
  ('herreria', 'MAQUINA ROLADORA',                      'maquina', true),
  ('herreria', 'MAQUINA CONFORMADORA DE TAPAS RURALES', 'maquina', true),
  ('herreria', 'MAQUINA CORTE DISCO',                   'maquina', true),
  ('herreria', 'ESTACION DE HERMETICIDAD',              'maquina', true);

-- 7) Montajes — un equipo por sector (la orden se reparte entre la cuadrilla)
insert into puestos_trabajo (sector_codigo, nombre, tipo, activo) values
  ('montajes-pa', 'Equipo Montajes Parte Activa', 'equipo', true),
  ('montajes-ph', 'Equipo Montajes Post Horno',   'equipo', true);

-- 8) Reasignar operarios de prueba al primer puesto de su sector
--    (para que el modal pre-seleccione algo razonable por defecto).
update operarios
set puesto_trabajo_id = (
  select p.id
  from puestos_trabajo p
  where p.sector_codigo = operarios.sector_codigo
    and p.activo
  order by p.nombre
  limit 1
);
