-- =================================================================
-- Inelpa · Migración 0004 · GRANTs para anon en tablas nuevas
-- Fecha: 2026-04-27
-- =================================================================
-- La migración 0003 creó las tablas items_orden / eventos / catálogos
-- de productos pero olvidó hacer GRANT explícito a la role `anon`.
--
-- Sin GRANT, las RLS policies no se evalúan: el cliente recibe un
-- "success" silencioso pero el UPDATE no persiste. Síntoma: el
-- planificador asigna puesto/operario/fechas, ve los datos en pantalla,
-- pero al refrescar todo vuelve al estado anterior.
--
-- Esta migración es idempotente (los GRANTs son no-op si ya existen).

-- Catálogos de producto — lectura
grant select on productos_terminados to anon;
grant select on semielaborados to anon;
grant select on bom_productos to anon;

-- Items de orden — lectura, inserción y actualización
-- (la RLS policy ya filtra qué filas y qué campos)
grant select, insert, update on items_orden to anon;

-- Órdenes de fabricación — la PWA crea/cancela órdenes desde admin
grant select, insert, update on ordenes_fabricacion to anon;

-- Eventos — el operario los crea, el supervisor los lee
grant select, insert on eventos to anon;

-- Función expandir_bom_a_items: la PWA la invoca desde NuevaOrdenForm
grant execute on function expandir_bom_a_items(uuid) to anon;
grant execute on function sector_de_familia_se(familia_se) to anon;
