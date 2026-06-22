# SeferPresenter

SeferPresenter es una aplicacion React/Vite para proyectar presentaciones con soporte para diapositivas, fondos, video, audio sincronizado y navegacion de textos sagrados. Esta orientada a un flujo online/local con control remoto, presenter y audiencia movil sincronizada.

## Modos de uso

- **Presenter**: abre `/presenter`. Muestra la diapositiva, fondo, video o lector de textos sagrados activo.
- **Control**: abre `/control`. Permite seleccionar presentaciones, editar slides, cambiar fondos, controlar audio/video y navegar textos.
- **Editor de audio**: abre `/audio-editor`. Permite asociar pistas de audio a presentaciones y cues de diapositiva.
- **Audiencia**: abre `/audience`. Muestra la misma proyeccion visual que presenter, en modo solo lectura y sincronizada.
- **Proteccion de datos**: `/proteccion-datos` queda como ruta publica (accesible sin autenticacion) para el aviso de privacidad del futuro modulo de voz en vivo.
- **Modo sin LiveKit**: la aplicacion conserva el uso solo presentacion. Si LiveKit esta desactivado, mal configurado o no soportado, `/presenter`, `/control`, `/audio-editor` y `/audience` deben seguir cargando sin requerir voz en vivo.

## Scripts

```bash
npm run dev          # backend local + servidor Vite frontend
npm run dev:frontend # solo servidor Vite frontend
npm run dev:backend  # backend local Node en http://localhost:8787
npm run docker:up    # stack completo con Docker Compose
npm run docker:down  # detener el stack completo de Docker Compose
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
- `GET /api/livekit/status`
- `POST /api/livekit/token`
- `POST /api/livekit/refresh-token`
- `POST /api/livekit/grant-speak`
- `POST /api/livekit/revoke-speak`
- `POST /api/livekit/mute-participant`
- `POST /api/livekit/mute-all`
- `POST /api/livekit/kick-participant`
- `POST /api/livekit/rescue-participant`

El backend tambien adjunta WebSocket en `ws://localhost:8787/ws`. En Fase 2
ese canal es propietario de la timeline de audio del servidor:
`WELCOME`, `SERVER_TIME_PING/PONG`, `AUDIO_TIMELINE_ACTION` y
`AUDIO_TIMELINE_STATE`. Ademas, los `REMOTE_COMMAND` de Control soportados se
reducen en el backend a `SYNC_STATE`, por lo que Control y Audiencia pueden
sincronizar navegacion sin requerir que `/presenter` este abierto. SSE y los
endpoints HTTP existentes siguen activos.

Si necesitas probar el stack completo con proxy, Redis y LiveKit, usa
`docker compose` mediante `npm run docker:up`. `npm run dev` sigue siendo util
para desarrollo local del frontend/backend, pero no sustituye el entorno
contenedorizado cuando quieres validar la ruta completa de voz en vivo.

En desarrollo, `npm run dev` arranca el backend local y Vite juntos. Vite proxya `/api` a `http://localhost:8787`. Si arrancas solo `npm run dev:frontend`, debes tener `npm run dev:backend` abierto en otra terminal. Para pruebas locales estables, ejecuta `npm run build` y despues `npm run start:local`.

## Seguridad por fases

En LAN/local no se exige autenticacion por defecto. Si se expone el servidor por puerto abierto o dominio, activa proteccion declarativa:

```bash
SEFER_REQUIRE_AUTH=true
SEFER_CONTROL_PASSWORD=una-clave-fuerte
npm run start:local
```

Con `SEFER_REQUIRE_AUTH=true`, `/control`, `/audio-editor` y endpoints mutantes bajo `/api` quedan protegidos con Basic Auth.

## PWA de audiencia y control

`/audience` y `/control` pueden instalarse como PWA con manifests separados:
`public/manifest.webmanifest` mantiene `start_url` y `scope` en `/audience`,
y `public/control-manifest.webmanifest` mantiene `start_url` y `scope` en
`/control`. Ambos usan el logo real `public/logo.svg` como icono.

El service worker `public/audience-sw.js` sirve ambos scopes. Cachea:

- shell minimo de audiencia/control con estrategia network-first;
- `metadata.json`;
- TSV biblicos bajo demanda;
- assets extra listados manualmente en `public/audience-cache-assets.txt`.

El archivo `public/audience-cache-assets.txt` acepta una ruta publica por linea y comentarios con `#`. No cachea endpoints vivos (`/api/*`, SSE, `/ws`, `/rtc/*`, LiveKit/tokens) ni videos/audios pesados. Si hay una actualizacion de service worker esperando, el boton de reinicio de la PWA la activa antes de recargar, sin borrar nick, respuestas de quiz ni estado local persistente.

### Diagnostico de permisos de microfono

La PWA no solicita microfono al cargar ni desde el service worker. El panel de
audio en vivo muestra diagnostico cuando aplica: `secureContext`,
`mediaDevices`, estado de permiso si el navegador soporta
`navigator.permissions`, y `error.name`/`error.message` si falla la peticion
manual del microfono.

El mensaje del navegador "Este sitio web no te puede pedir permisos" suele
aparecer por estas causas: no usar HTTPS o localhost, estar dentro de un iframe
sin `allow="microphone"`, una `Permissions-Policy` que bloquea microfono,
permiso bloqueado en la configuracion del sitio, PWA instalada con contexto
antiguo/inseguro, o pedir microfono fuera de un gesto del usuario.

## Arquitectura

La aplicacion se organiza por consumidor:

- `src/components/control/`: panel de operador y controles interactivos.
- `src/components/presenter/`: pantalla de proyeccion y lector visual.
- `src/components/audience/`: envoltorio de audiencia para mostrar la proyeccion sin controles.
- `src/components/shared/`: componentes comunes.
- `src/hooks/`: logica de sincronizacion, navegacion, fondos, audio, escritura y teclado.
- `src/types/`: contratos compartidos de presentacion, audio, audiencia, sincronizacion y transliteracion.
- `src/types/liveAudio.ts`: contratos opcionales de voz en vivo, separados del estado de presentacion y sin conexion LiveKit runtime.
- `src/features/liveAudio/`: implementacion opcional LiveKit. Los hooks, UI, helpers criptograficos y cualquier import del SDK cliente LiveKit (`livekit-client`) deben vivir ahi, no en el core.
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
local y WebSocket para la timeline de audio backend-owned. El estado canonico de
proyeccion vive en el backend local; Presenter lo muestra, pero no es requerido
como fuente funcional para comandos de Control.

Canales principales:

- `SYNC_STATE`: navegacion y estado completo necesario para inicializacion.
- `REMOTE_COMMAND`: intencion de Control reducida por el backend para comandos
  de proyeccion soportados.
- `AUDIO_TELEMETRY`: estado ligero de reproduccion de audio.
- `VIDEO_TELEMETRY`: estado ligero de reproduccion de video.
- `DISPLAY_TELEMETRY`: cambios de fondo, override y candado.
- `AUDIO_TIMELINE_STATE`: estado de timeline de audio emitido por `/ws` para presenter/control.
- Familia Live Audio: mensajes opcionales tipados para voz en vivo
  (`LIVE_AUDIO_*`, `CONTROL_KEY_ROTATED`, `PRIVATE_CONTROL_SIGNAL`) separados de
  `SYNC_STATE`, `AudioState` y `AudioTimelineState`.
- `LIVE_AUDIO_SNAPSHOT_REQUEST` / `LIVE_AUDIO_SNAPSHOT`: snapshot operacional
  efimero para Controles autorizados, con participantes, cola, autorizaciones,
  estado LiveKit y agregados anonimos de quiz. Controles pendientes no lo reciben.

La audiencia muestra la misma imagen viva del presenter, sin controles de navegacion ni apertura del panel de control.

`PRIVATE_CONTROL_SIGNAL` es un contenedor tecnico cifrado para senales privadas
entre Audience y controles autorizados. No contiene alias, mensajes ni
configuracion de micro en claro, y el servidor debe limitarse a validar/rutear
sin descifrar ni persistir contenido.
La capa E2E simplificada usa Web Crypto: Control publica una clave publica ECDH
P-256, Audience cifra con una clave AES-GCM 256 derivada y un nonce aleatorio de
12 bytes por mensaje, y las claves privadas quedan solo en memoria del cliente.
El servidor WebSocket gestiona el Control principal: la primera conexion
`/control` es `PRINCIPAL`, las siguientes quedan `PENDING` con codigo `NNN-NNN`
temporal, y solo Controles autorizados reciben senales privadas o pueden emitir
acciones de moderacion.

## Live Audio opcional

Live Audio mantiene el protocolo en el core y aisla el runtime LiveKit bajo
`src/features/liveAudio/`.

- `VITE_SEFER_LIVE_AUDIO_BUILD`: flag de build frontend. Cuando sea `false`, el
  bundle base no debe importar estaticamente `src/features/liveAudio/` ni incluir
  el SDK cliente LiveKit.
- `SEFER_LIVE_AUDIO_ENABLED`: flag backend/runtime. Cuando sea `false`, el
  servidor debe reportar voz en vivo desactivada y conservar los flujos actuales
  de presentacion, audience, control, media, quiz y textos.

El paquete npm instalado para el SDK del navegador es `livekit-client`. No debe
importarse desde `src/App.tsx`, `src/hooks/useSyncState.ts`,
`src/components/shared/` existente ni tipos compartidos; debe quedar aislado
dentro de `src/features/liveAudio/` o cargarse dinamicamente desde ese modulo.

### Backend LiveKit self-hosted

Fase 5.4 agrega endpoints backend para tokens y moderacion, con estado solo en
memoria. Si `SEFER_LIVE_AUDIO_ENABLED=false` o faltan `LIVEKIT_URL`,
`LIVEKIT_API_KEY` o `LIVEKIT_API_SECRET`, el servidor sigue arrancando y
`GET /api/livekit/status` responde que Live Audio esta desactivado o no
disponible. Las respuestas de estado no exponen secretos.

Para validar Live Audio end-to-end con LiveKit real, el camino soportado es
Docker Compose (`npm run docker:up`), porque el stack incluye `caddy`, `redis`
y `livekit` junto con la app.

Variables:

```bash
SEFER_LIVE_AUDIO_ENABLED=false
SEFER_LIVE_AUDIO_PUBLIC_LISTEN=true
SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES=30
SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS=60
SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS=true
SEFER_LIVE_AUDIO_CONTROL_CODE_TTL_SECONDS=90
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_ROOM_NAME=sefer-live-audio
```

Endpoints:

- `GET /api/livekit/status`: devuelve `{ enabled, available?, reason? }`.
- `POST /api/livekit/token`: entrada `{ role, roomSession? }`; devuelve
  `livekitUrl`, `token`, `expiresAt`, `participantIdentity` y `participantId`
  efimero. `audience` recibe permiso de solo suscripcion; `control` recibe
  permiso de publicar audio.
- `POST /api/livekit/refresh-token`: renueva un token para un participante activo
  en memoria antes de expirar, preservando `participantId` e identidad LiveKit
  cuando el participante sigue dentro del margen de retorno.
- `POST /api/livekit/grant-speak`, `revoke-speak`, `mute-participant`,
  `mute-all`, `kick-participant`, `rescue-participant`: requieren
  `role: "control"` y un `controlSessionId` autorizado por WebSocket.
  `audience` recibe 403. `rescue-participant` devuelve al usuario expulsado a
  audiencia activa muda (`LISTENER`) sin abrir ni publicar microfono.

No hay endpoints de consentimiento, alias legible ni chat legible. El backend no
persiste claves, alias, tokens ni mensajes privados en archivos o base de datos.
El snapshot operacional vive solo en memoria; las partes sensibles que el
servidor llega a conocer por parches de Control autorizado se cifran con una
clave derivada de `SEFER_CONTROL_PASSWORD` y no se guardan en disco.

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
