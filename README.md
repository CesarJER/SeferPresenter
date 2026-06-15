# SeferPresenter

SeferPresenter es una aplicacion React/Vite para proyectar presentaciones con soporte para diapositivas, fondos, video, audio sincronizado y navegacion de textos sagrados. Esta orientada a un flujo online/local con control remoto, presenter y audiencia movil sincronizada.

## Modos de uso

- **Presenter**: abre `/presenter`. Muestra la diapositiva, fondo, video o lector de textos sagrados activo.
- **Control**: abre `/control`. Permite seleccionar presentaciones, editar slides, cambiar fondos, controlar audio/video y navegar textos.
- **Editor de audio**: abre `/audio-editor`. Permite asociar pistas de audio a presentaciones y cues de diapositiva.
- **Audiencia**: abre `/audience`. Muestra la misma proyeccion visual que presenter, en modo solo lectura y sincronizada.

## Scripts

```bash
npm run dev          # backend local + servidor Vite frontend
npm run dev:frontend # solo servidor Vite frontend
npm run dev:backend  # backend local Node en http://localhost:8787
npm run build        # build web
npm run start:local  # backend local sirviendo dist/
npm run test         # Vitest
npm run lint         # ESLint
npx tsc --noEmit     # verificacion estricta de tipos
```

Los scripts `predev`, `prebuild` y `prebuild:web` regeneran `public/books/*.tsv` y `public/metadata.json` desde los datos biblicos externos.

## Backend local

El backend local vive en `server/local-server.mjs`. Mantiene inicialmente la misma superficie API que tenia el backend embebido en Vite:

- `GET /api/state`
- `GET /api/state-events`
- `POST /api/state`
- `POST /api/audio-telemetry`
- `POST /api/video-telemetry`
- `POST /api/display-telemetry`
- `GET /api/backgrounds`
- `GET /api/audio`
- `GET /api/audio-sync`
- `POST /api/audio-sync`
- `GET /api/presentations`
- `POST /api/presentations`
- `GET /api/audience/state`
- `GET /api/audience/events`
- `GET /api/audience-cache-assets`

El backend tambien adjunta WebSocket en `ws://localhost:8787/ws`. En Fase 2
ese canal solo es propietario de la timeline de audio del servidor:
`WELCOME`, `SERVER_TIME_PING/PONG`, `AUDIO_TIMELINE_ACTION` y
`AUDIO_TIMELINE_STATE`. SSE y los endpoints HTTP existentes siguen activos.

En desarrollo, `npm run dev` arranca el backend local y Vite juntos. Vite proxya `/api` a `http://localhost:8787`. Si arrancas solo `npm run dev:frontend`, debes tener `npm run dev:backend` abierto en otra terminal. Para pruebas locales estables, ejecuta `npm run build` y despues `npm run start:local`.

## Seguridad por fases

En LAN/local no se exige autenticacion por defecto. Si se expone el servidor por puerto abierto o dominio, activa proteccion declarativa:

```bash
SEFER_REQUIRE_AUTH=true
SEFER_CONTROL_PASSWORD=una-clave-fuerte
npm run start:local
```

Con `SEFER_REQUIRE_AUTH=true`, `/control`, `/audio-editor` y endpoints mutantes bajo `/api` quedan protegidos con Basic Auth.

## Audiencia PWA

La PWA aplica solo a `/audience`. Cachea:

- shell minimo de audiencia;
- `metadata.json`;
- TSV biblicos bajo demanda;
- assets extra listados manualmente en `public/audience-cache-assets.txt`.

El archivo `public/audience-cache-assets.txt` acepta una ruta publica por linea y comentarios con `#`. No cachea videos ni audios pesados salvo que se incluyan explicitamente.

## Arquitectura

La aplicacion se organiza por consumidor:

- `src/components/control/`: panel de operador y controles interactivos.
- `src/components/presenter/`: pantalla de proyeccion y lector visual.
- `src/components/audience/`: envoltorio de audiencia para mostrar la proyeccion sin controles.
- `src/components/shared/`: componentes comunes.
- `src/hooks/`: logica de sincronizacion, navegacion, fondos, audio, escritura y teclado.
- `src/types/`: contratos compartidos de presentacion, audio, audiencia, sincronizacion y transliteracion.
- `src/utils/`: normalizacion, parsing, lookup biblico, metadata y utilidades puras.
- `server/`: backend local Node.

## Documentacion para agentes AI

- `AGENTS.md`: guia rapida que debe leerse primero al iniciar trabajo automatizado.
- `docs/AI_PROJECT_MAP.md`: mapa rapido del codigo y rutas de cambio comunes.
- `docs/COMPONENT_OWNERSHIP.md`: ownership de componentes y categorias de estado.
- `docs/CHANGE_GUIDE.md`: checklists para cambios futuros.
- `docs/SYNC_ARCHITECTURE.md`: arquitectura actual de sincronizacion y direccion backend-ready.
- `docs/SYMBOL_INDEX.md`: indice de simbolos y archivos importantes.
- `docs/ai-navigation.md`: vista condensada de navegacion para lectura rapida.

## Sincronizacion

La sincronizacion usa `BroadcastChannel` para pestanas locales, SSE/API para red
local y WebSocket para la timeline de audio backend-owned.

Canales principales:

- `SYNC_STATE`: navegacion y estado completo necesario para inicializacion.
- `AUDIO_TELEMETRY`: estado ligero de reproduccion de audio.
- `VIDEO_TELEMETRY`: estado ligero de reproduccion de video.
- `DISPLAY_TELEMETRY`: cambios de fondo, override y candado.
- `AUDIO_TIMELINE_STATE`: estado de timeline de audio emitido por `/ws` para presenter/control.

La audiencia muestra la misma imagen viva del presenter, sin controles de navegacion ni apertura del panel de control.

## Legacy

`legacy/` es registro local de desarrollo. No forma parte del producto, no debe ir al build y queda fuera de ESLint.

## Verificacion recomendada

Antes de cerrar cambios importantes:

```bash
npx tsc --noEmit
npm run test
npm run lint
npm run build
```

En Windows, si PowerShell bloquea `npm.ps1` o `npx.ps1`, usa:

```bash
npm.cmd run test
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

## Checklist manual

- Abrir `/presenter` y `/control` en ventanas separadas.
- Seleccionar una presentacion y navegar slides.
- Probar fondos: override manual, candado, `Principal`, `Anterior`, `Ignorar`.
- Probar audio: pista, play/pause, volumen, seek y modos de sync.
- Probar video: play/pause, loop, velocidad, volumen y seek.
- Probar Sefer/Tanaj: proyectar, navegar versos, anadir slide.
- Abrir `/audio-editor` y guardar mapas de audio.
- Abrir `/audience` en movil o viewport movil y verificar que no hay controles.

## Notas de mantenimiento

- No editar datos generados en `public/books/` a mano; se regeneran desde `scripts/generate-verses.js`.
- Mantener telemetria de media/display en canales ligeros.
- Preferir utilidades compartidas en `src/utils/` antes de duplicar parsing o normalizacion.
- Mantener la pantalla de proyeccion liviana y la audiencia aun mas ligera.
