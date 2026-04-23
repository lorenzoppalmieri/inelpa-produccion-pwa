-- =======================================================================
-- Inelpa · Registro de Producción — Policies para panel admin
-- Fecha: 2026-04-22
--
-- Añade policies de INSERT/UPDATE para que el panel admin (usando anon key
-- con PIN propio en la UI) pueda crear y cancelar órdenes y sus etapas.
--
-- NOTA TEMPORAL: esto amplía los permisos de anon. Cuando tengamos auth
-- real (Supabase Auth con rol "admin"), reemplazamos estas políticas por
-- otras basadas en rol. Por ahora es aceptable porque:
--   1. La app se usa solo en la red interna de planta.
--   2. El PIN admin actúa como gate en la UI antes de exponer los forms.
--   3. No hay datos sensibles externos en juego.
-- =======================================================================

-- ------------------------------------------------------------------
-- Órdenes de fabricación
-- ------------------------------------------------------------------
drop policy if exists "anon crea ordenes" on ordenes_fabricacion;
drop policy if exists "anon actualiza ordenes" on ordenes_fabricacion;

create policy "anon crea ordenes" on ordenes_fabricacion
  for insert to anon
  with check (true);

create policy "anon actualiza ordenes" on ordenes_fabricacion
  for update to anon
  using (estado in ('pendiente', 'en_proceso'))
  with check (estado in ('pendiente', 'en_proceso', 'completada', 'cancelada'));

-- ------------------------------------------------------------------
-- Etapas de orden
-- ------------------------------------------------------------------
-- La policy de SELECT y UPDATE ya existe; agregamos INSERT para el admin.
drop policy if exists "anon crea etapas" on etapas_orden;

create policy "anon crea etapas" on etapas_orden
  for insert to anon
  with check (true);
