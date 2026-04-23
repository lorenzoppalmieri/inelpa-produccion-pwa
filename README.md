# Inelpa · PWA de Registro de Producción

PWA para registrar eventos de producción (inicios, fines, demoras, observaciones) desde los PC panel de planta. Funciona offline y sincroniza contra Supabase cuando hay conexión.

## Stack

- **Frontend:** React 18 + Vite 5 + TypeScript
- **Estilos:** Tailwind CSS (clases `btn-touch`, tamaños grandes para pantalla táctil)
- **Routing:** React Router 6
- **PWA / Service Worker:** `vite-plugin-pwa` (Workbox)
- **Offline DB:** Dexie (wrapper sobre IndexedDB) + cola de sync propia
- **Backend:** Supabase (Postgres + Auth + REST)

## Arranque local

Prerequisitos: Node 20+ y npm 10+ (probado contra Node 22).

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar las variables de entorno y completar con el proyecto Supabase
cp .env.example .env.local
# editar .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY

# 3. Levantar dev server
npm run dev
# → http://localhost:5173 (accesible también en la LAN por el host:5173)

# 4. Build de producción
npm run build
npm run preview
```

## Estructura

```
src/
├── db/
│   ├── dexie.ts        # Esquema IndexedDB (eventos, causas, kv)
│   └── sync.ts         # Motor de sync a Supabase (batch + reintentos)
├── lib/
│   ├── supabase.ts     # Cliente Supabase
│   └── registerSW.ts   # Registro del service worker
├── hooks/
│   ├── useOnlineStatus.ts
│   └── usePendingSyncCount.ts
├── screens/
│   └── HomeScreen.tsx  # Placeholder — se reemplaza con el flujo real
├── components/         # (vacío por ahora)
├── types/
│   └── evento.ts       # Modelo base — a completar con el acordado
├── App.tsx
├── main.tsx
└── index.css           # Tailwind + utilitarias de botón táctil
```

## Notas de diseño

- **Offline-first:** todo evento se persiste primero en IndexedDB con `syncStatus='pending'`. El sync a Supabase es asíncrono; los eventos nunca se pierden si cae la red.
- **Pensado para PC panel:** viewport bloqueado contra zoom, botones mínimos de 64px de alto, fuentes grandes (`text-touch-*`).
- **Service worker:** `registerType: autoUpdate` — las actualizaciones se aplican al próximo reload sin intervención del operario.
- **Cache de Supabase:** estrategia `NetworkFirst` con timeout corto, de modo que una caída de red no rompe la UI.

## Próximos pasos

1. Definir/confirmar el modelo de datos final y subir migraciones a Supabase.
2. Cargar el catálogo de causas de demora en la tabla correspondiente.
3. Reemplazar `HomeScreen` por el flujo real de pantallas.
4. Agregar autenticación de operario (legajo + PIN).
5. Configurar RLS en Supabase para limitar inserciones por sector/operario.
6. CI + deploy (Vercel o Netlify; la PWA se instala desde el navegador del PC panel).

## Seguridad

La `VITE_SUPABASE_ANON_KEY` queda embebida en el bundle — esto es esperado. La seguridad real se implementa con **Row Level Security** en Postgres. Nunca uses la `service_role` key en el frontend.
