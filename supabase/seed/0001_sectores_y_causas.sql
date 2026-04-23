-- =======================================================================
-- Seed inicial: sectores, puestos de trabajo, operarios de prueba, causas.
-- Causas consolidadas y normalizadas desde los 3 docs originales.
-- =======================================================================

-- ------------------------------------------------------------------
-- SECTORES
-- ------------------------------------------------------------------
insert into sectores (codigo, nombre, orden_secuencia) values
  ('bobinado-at',  'Bobinado AT',         1),
  ('bobinado-bt',  'Bobinado BT',         2),
  ('herreria',     'Herrería',            3),
  ('montajes-pa',  'Montajes Parte Activa', 4),
  ('montajes-ph',  'Montajes Post Horno',   5);

-- ------------------------------------------------------------------
-- PUESTOS DE TRABAJO DE MUESTRA (ajustar con los reales)
-- ------------------------------------------------------------------
insert into puestos_trabajo (sector_codigo, nombre, tipo) values
  ('bobinado-at', 'Bobinadora AT #1', 'maquina'),
  ('bobinado-at', 'Bobinadora AT #2', 'maquina'),
  ('bobinado-at', 'Bobinadora AT #3', 'maquina'),
  ('bobinado-bt', 'Bobinadora BT #1', 'maquina'),
  ('bobinado-bt', 'Bobinadora BT #2', 'maquina'),
  ('herreria',    'Box Herrería #1',  'box'),
  ('herreria',    'Box Herrería #2',  'box'),
  ('herreria',    'Box Herrería #3',  'box'),
  ('montajes-pa', 'Cinta Parte Activa', 'equipo'),
  ('montajes-ph', 'Cinta Post Horno',   'equipo');

-- ------------------------------------------------------------------
-- OPERARIOS DE MUESTRA (ajustar con los reales)
-- ------------------------------------------------------------------
insert into operarios (pin, nombre, apellido, sector_codigo) values
  (1001, 'Juan',    'Pérez',    'bobinado-at'),
  (1002, 'María',   'Gómez',    'bobinado-bt'),
  (1003, 'Carlos',  'López',    'herreria'),
  (1004, 'Ana',     'Rodríguez','montajes-pa'),
  (1005, 'Diego',   'Martínez', 'montajes-ph');

-- ------------------------------------------------------------------
-- CATÁLOGO DE CAUSAS DE DEMORA
-- Códigos DEM-001..DEM-011: universales (todos los sectores)
-- DEM-020s: específicas Bobinado
-- DEM-040s: específicas Herrería
-- DEM-060s-090s: específicas Montajes Parte Activa
-- DEM-100s: específicas Montajes Post Horno
-- ------------------------------------------------------------------

-- UNIVERSALES (aplican a todos los sectores)
insert into causas_demora (codigo, descripcion, categoria, sectores_aplicables) values
  ('DEM-001', 'Capacitación',                    'PERSONAL',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-002', 'Retiro',                          'PERSONAL',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-003', 'Reunión informativa / charla',    'PERSONAL',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-004', 'Retrabajo propio',                'RETRABAJO',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-005', 'Ayuda en sector u otro sector',   'OPERATIVA',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-006', 'Mantenimiento',                   'EQUIPO',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-007', 'Accidente laboral',               'PERSONAL',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-008', 'Suspensión',                      'PERSONAL',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-009', 'Licencia / ausencia no programada','PERSONAL',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-010', 'Orden y limpieza',                'OPERATIVA',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-011', 'Ninguno',                         'OTRO',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]),
  ('DEM-012', 'Otro',                            'OTRO',
   array['bobinado-at','bobinado-bt','herreria','montajes-pa','montajes-ph']::sector_codigo[]);

-- BOBINADO AT y BT (específicas)
insert into causas_demora (codigo, descripcion, categoria, sectores_aplicables) values
  ('DEM-020', 'Espera de materiales logísticos',                   'ESPERA_MATERIAL',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-021', 'Espera de materiales del sector Corte de aislación','ESPERA_MATERIAL',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-022', 'Espera de bobina de BT',                            'ESPERA_MATERIAL',
   array['bobinado-at']::sector_codigo[]),
  ('DEM-023', 'Espera de equipo soldador',                         'ESPERA_HERRAMIENTA',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-024', 'Retrabajo de tercero',                              'RETRABAJO',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-025', 'Espera de ficha técnica',                           'ESPERA_MATERIAL',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-026', 'Espera al encargado',                               'OPERATIVA',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-027', 'Replanificación de la producción',                  'OPERATIVA',
   array['bobinado-at','bobinado-bt']::sector_codigo[]),
  ('DEM-028', 'Taco defectuoso',                                   'CALIDAD',
   array['bobinado-at','bobinado-bt']::sector_codigo[]);

-- HERRERÍA (específicas)
insert into causas_demora (codigo, descripcion, categoria, sectores_aplicables) values
  ('DEM-040', 'Espera cuba',                                       'ESPERA_MATERIAL',
   array['herreria']::sector_codigo[]),
  ('DEM-041', 'Espera materiales / herramientas',                  'ESPERA_MATERIAL',
   array['herreria']::sector_codigo[]),
  ('DEM-042', 'Retrabajo de un 3° del sector',                     'RETRABAJO',
   array['herreria']::sector_codigo[]),
  ('DEM-043', 'Pérdidas en hermetizado',                           'CALIDAD',
   array['herreria']::sector_codigo[]),
  ('DEM-044', 'Falta de tapa',                                     'ESPERA_MATERIAL',
   array['herreria']::sector_codigo[]),
  ('DEM-045', 'Retrabajo en su cuba / tapa / tanque',              'RETRABAJO',
   array['herreria']::sector_codigo[]),
  ('DEM-046', 'Realización de trabajos no planificados',           'OPERATIVA',
   array['herreria']::sector_codigo[]),
  ('DEM-047', 'Finaliza trabajo de compañero',                     'OPERATIVA',
   array['herreria']::sector_codigo[]),
  ('DEM-048', 'Retrabajo de otro sector',                          'RETRABAJO',
   array['herreria']::sector_codigo[]),
  ('DEM-049', 'Retrabajo por problemas de proveedor',              'EXTERNO',
   array['herreria']::sector_codigo[]),
  ('DEM-050', 'Hermetizado',                                       'OPERATIVA',
   array['herreria']::sector_codigo[]);

-- MONTAJES PARTE ACTIVA (específicas)
insert into causas_demora (codigo, descripcion, categoria, sectores_aplicables) values
  ('DEM-060', 'Espera / faltan prensayugos',                       'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-061', 'Pintaron prensayugos en el sector',                 'OPERATIVA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-062', 'Retrabajo bobina',                                  'RETRABAJO',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-063', 'Espera / falta núcleo',                             'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-064', 'No dan relación las bobinas',                       'CALIDAD',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-065', 'Materiales o insumos defectuosos (chapa, prensayugos, llave, ángulos)', 'CALIDAD',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-066', 'Espera secado pintura o barnizado',                 'OPERATIVA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-067', 'Cables cortos en las bobinas — alarga derivaciones','RETRABAJO',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-068', 'Espera relaciómetro',                               'ESPERA_HERRAMIENTA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-069', 'Error en entrega de insumos',                       'EXTERNO',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-070', 'Relacionar bobinas de otro transformador',          'OPERATIVA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-071', 'Sigue con otro modelo de PA',                       'OPERATIVA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-072', 'Sin puente grúa',                                   'EQUIPO',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-073', 'Sin luz',                                           'EQUIPO',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-074', 'Sin lugar / obstrucción en el sector',              'OPERATIVA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-075', 'Espera bobina',                                     'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-076', 'Espera / faltan chapones',                          'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-077', 'Espera / faltan tacos',                             'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-078', 'Espera cartones',                                   'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-079', 'Espera patas',                                      'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-080', 'Espera chapa',                                      'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-081', 'Modificación de materiales / insumos recibidos',    'CALIDAD',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-082', 'Espera tubo de oxígeno',                            'ESPERA_MATERIAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-083', 'Espera horno',                                      'EQUIPO',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-084', 'Control / revisión de trabajo',                     'CALIDAD',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-085', 'Preparación de materiales / insumos',               'OPERATIVA',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-086', 'Espera / falta soldador',                           'PERSONAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-087', 'Espera / falta aislador',                           'PERSONAL',
   array['montajes-pa']::sector_codigo[]),
  ('DEM-088', 'Solucionando retrabajo',                            'RETRABAJO',
   array['montajes-pa']::sector_codigo[]);

-- MONTAJES POST HORNO (específicas)
insert into causas_demora (codigo, descripcion, categoria, sectores_aplicables) values
  ('DEM-100', 'Falta de materiales logísticos',                    'ESPERA_MATERIAL',
   array['montajes-ph']::sector_codigo[]),
  ('DEM-101', 'Falta cuba / tapa / tanque de expansión',           'ESPERA_MATERIAL',
   array['montajes-ph']::sector_codigo[]),
  ('DEM-102', 'Falta aceite',                                      'ESPERA_MATERIAL',
   array['montajes-ph']::sector_codigo[]),
  ('DEM-103', 'Falló secado de horno',                             'EQUIPO',
   array['montajes-ph']::sector_codigo[]),
  ('DEM-104', 'Falta de puente grúa',                              'EQUIPO',
   array['montajes-ph']::sector_codigo[]),
  ('DEM-105', 'Falta de espacio',                                  'OPERATIVA',
   array['montajes-ph']::sector_codigo[]);

-- ------------------------------------------------------------------
-- ORDEN DE FABRICACIÓN DE PRUEBA (para testear el flujo)
-- ------------------------------------------------------------------
insert into ordenes_fabricacion (codigo, descripcion, cliente) values
  ('OF-2026-001', 'Transformador 500kVA 13.2/0.4kV', 'Cliente Demo');

-- Crear las 5 etapas de la orden demo
insert into etapas_orden (orden_id, sector_codigo, secuencia)
select o.id, s.codigo, s.orden_secuencia
from ordenes_fabricacion o, sectores s
where o.codigo = 'OF-2026-001';
