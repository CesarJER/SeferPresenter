# SeferPresenter

SeferPresenter es una aplicacion React/Vite para proyectar presentaciones con soporte para diapositivas, fondos, video, audio sincronizado y navegacion de textos sagrados. Esta orientada a un flujo online/local con control remoto, presenter y audiencia movil sincronizada.

## Modos de uso

- **Presenter**: abre `/presenter`. Muestra la diapositiva, fondo, video o lector de textos sagrados activo.
- **Control**: abre `/control`. Permite seleccionar presentaciones, editar slides, cambiar fondos, controlar audio/video y navegar textos.
- **Editor de audio**: abre `/audio-editor`. Permite asociar pistas de audio a presentaciones y cues de diapositiva.
- **Audiencia**: abre `/audience`. Muestra la misma proyeccion visual que presenter, en modo solo lectura y sincronizada.
- **Catálogo Público**: rutas dinámicas configurables vía `SEFER_PUBLIC_CATALOG_TAGS` en `.env` (ej: `/temas`). Muestra una versión pública, segura y de solo lectura de las presentaciones, omitiendo metadatos privados y bloques de medios.
- **Proteccion de datos**: `/proteccion-datos` carga la política de la publicación
  legal activa, la presenta con tablas GFM y muestra su versión y SHA-256. La
  ruta interna no se expone y la consulta permanece pública antes de participar.
- **Modo sin LiveKit**: la aplicacion conserva el uso solo presentacion. Si LiveKit esta desactivado, mal configurado o no soportado, `/presenter`, `/control`, `/audio-editor`, `/audience` y catálogos deben seguir cargando sin requerir voz en vivo.
- **Modo sin Voice Scripture**: es el modo normal. La navegación por voz, el STT,
  el modelo y la GPU son opcionales y no forman parte del bundle base.

## Scripts

```bash
npm run dev          # backend local + servidor Vite frontend
npm run dev:frontend # solo servidor Vite frontend
npm run dev:backend  # backend local Node en http://localhost:8787
npm run docker:up    # stack base (app + Caddy), sin Live Audio
npm run docker:down  # detener el stack completo de Docker Compose
npm run build        # build web
npm run start:local  # backend local sirviendo dist/
npm run test         # Vitest
npm run lint         # ESLint
npm run generate:scripture # regenerar corpus local de forma explicita
npx tsc --noEmit     # verificacion estricta de tipos
npm run index:memory # re-indexar grafo AST con codebase-memory-mcp
```

`dev` no genera ni copia el corpus. Antes de cada `build`,
`npm run generate:scripture` compara el SHA-256 de `SEFER_VERSES_SOURCE` con
`SEFER_DATA_DIR/config/verses-source.sha256`: solo regenera los libros y
metadatos cuando cambia el origen. Si falta, muestra una advertencia y el build
continúa sin modificar datos.

## Datos de una instalacion self-hosted

El codigo no versiona las presentaciones ni los mapas de audio del operador.
El backend lee y escribe esos ficheros dentro de `SEFER_DATA_DIR`:

```text
SeferPrivateData/
├── presentations.json
├── audio_sync.json
├── config/audience-cache-assets.txt
├── branding/
│   ├── logo.svg       # override opcional
│   ├── favicon.svg    # override opcional
│   └── welcome.md     # override opcional
├── public/             # árbol servido conservando sus rutas relativas
│   ├── audio/
│   ├── backgrounds/
│   ├── videos/
│   ├── books/
│   └── metadata.json
└── tmp/
```

Las rutas relativas se resuelven desde la raiz de SeferPresenter. En desarrollo
puede configurarse una instalacion privada hermana mediante un `.env`
ignorado por Git:

```dotenv
SEFER_DATA_DIR=../SeferPrivateData
SEFER_VERSES_SOURCE=../Sefer-Data/data/raw/protected/generated/versiculos.tsv
```

Si la variable no existe, se usa `./data.local`. En el primer arranque se
copian los archivos ausentes desde `examples/SeferPrivateData/`; nunca se
sobrescribe un archivo ya existente. El directorio de ejemplo es neutral y no
debe utilizarse para guardar cambios del operador.

Todo archivo bajo `SEFER_DATA_DIR/public/` se sirve conservando su ruta relativa.
Los listados de audio y fondos recorren ese árbol completo por extensión, por lo
que el operador puede reorganizar sus subcarpetas sin añadir montajes ni cambiar
el backend. El build neutral tiene prioridad si una ruta colisiona con un activo
del producto. Así cada instalación aporta sus propios medios y corpus mediante
un único montaje, sin incorporarlos al build ni al repositorio público.

El navegador solicita el branding mediante `/api/branding/logo.svg`,
`/api/branding/favicon.svg` y `/api/branding/welcome.md`. Un archivo privado
tiene prioridad; si falta, se utiliza el recurso neutral de
`src/assets/branding/`. Los SVG se sirven como imágenes con MIME explícito y
`nosniff`; nunca se inserta su código dentro del DOM. Logo y favicon admiten
caché de siete días, mientras que la bienvenida se revalida tras cinco minutos;
los tres recursos usan ETag basado en su contenido. La bienvenida se carga en
runtime con HTML crudo deshabilitado y Markdown normal, incluidas imágenes, por
lo que el branding del operador no entra en `dist/`. El rayo neutral también se
incluye como asset con hash del build y se usa si el endpoint del logotipo no
puede cargarse; los assets con hash usan caché anual `immutable`.

## Backend local

El backend local vive en `server/local-server.mjs`. Mantiene inicialmente la misma superficie API que tenia el backend embebido en Vite:

- `GET /api/state`
- `GET /api/state-events`
- `POST /api/state`
- `POST /api/audio-telemetry`
- `POST /api/video-telemetry`
- `POST /api/display-telemetry`
- `GET /api/backgrounds` (imágenes AVIF, GIF, JPEG, PNG, SVG y WebP; vídeo MP4 y WebM)
- `GET /api/audio`
- `GET /api/audio-sync`
- `POST /api/audio-sync`
- `GET /api/presentations`
- `POST /api/presentations`
- `GET /api/public-catalogs`
- `GET /api/public-catalogs/:id/presentations`
- `POST /api/audience/access/bootstrap` (credencial efímera de la sesión Audience)
- `POST /api/audience/sse-ticket` (ticket de un solo uso para SSE de estado o quiz)
- `GET /api/audience/state` (snapshot `SYNC_STATE`; exige credencial en modo controlado)
- `GET /api/audience/events` (SSE equivalente; exige ticket en modo controlado)
- `GET /api/audience-cache-assets`
- `GET /api/branding/logo.svg`
- `GET /api/branding/favicon.svg`
- `GET /api/branding/welcome.md`
- `POST /api/quiz-answer`
- `GET /api/quiz-events` (eventos no sensibles; exige ticket en modo controlado)
- `GET /api/quiz-control-events` (agregados, requiere autenticación)
- `POST /api/quiz-control-state` (snapshot agregado, requiere autenticación)
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

Si necesitas probar el stack completo con proxy, Redis y LiveKit, activa el
perfil opcional con `docker compose --profile live-audio up --build`. El perfil
requiere `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`. Configure `LIVEKIT_NODE_IP`
de forma expresa. Para servidores con IP dinámica puede habilitar
conscientemente `LIVEKIT_NODE_IP_AUTO_DETECT=true`; el contenedor consulta solo
proveedores HTTPS permitidos, valida una respuesta IPv4 y falla si no obtiene
una válida.
Antes de construirlo, activa tambien `SEFER_LIVE_AUDIO_ENABLED=true` y
`VITE_SEFER_LIVE_AUDIO_BUILD=true` en el entorno.
`npm run dev` sigue siendo util
para desarrollo local del frontend/backend, pero no sustituye el entorno
contenedorizado cuando quieres validar la ruta completa de voz en vivo.

En desarrollo, `npm run dev` arranca el backend local y Vite juntos. Vite proxya
`/api`, medios y corpus a `http://localhost:8787`. Si arrancas solo
`npm run dev:frontend`, debes tener `npm run dev:backend` abierto en otra
terminal. Para pruebas locales estables, ejecuta `npm run build` y despues
`npm run start:local`.

## Seguridad

La autenticacion administrativa esta habilitada por defecto incluso cuando
`SEFER_REQUIRE_AUTH` no existe. Configure una clave fuerte antes de arrancar el
backend de produccion:

```bash
SEFER_REQUIRE_AUTH=true
SEFER_CONTROL_PASSWORD=una-clave-fuerte
npm run start:local
```

Con `SEFER_REQUIRE_AUTH=true`, `/control`, `/audio-editor`, `/presenter`, APIs
administrativas y WebSocket privilegiado quedan protegidos con Basic Auth.
`npm run dev` establece de forma explicita `SEFER_REQUIRE_AUTH=false` si la
variable no fue definida; no use ese opt-out para un despliegue expuesto.

## Privacidad local, documento legal y logs

- El Git privado anidado `SEFER_DATA_DIR/legal/` contiene publicaciones
  inmutables. `current.json` selecciona una secuencia y cada manifiesto encadena
  y verifica los SHA-256 de sus documentos y del manifiesto anterior.
- `SEFER_DATA_DIR/config/legal-activation.json` conserva la mayor secuencia
  activada. El backend rechaza retroversiones, cadenas rotas y archivos alterados.
- `/legal/privacy.md` y `/legal/privacy-summary.md` son URL públicas estables;
  nunca revelan la ruta física. Si no existe repositorio legal se muestran las
  plantillas neutrales de `static/legal/` y `/api/legal/manifest` responde
  `LEGAL_NOT_CONFIGURED`.
- `VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS` controla la caducidad de sesión,
  respuestas y puntuaciones Audience: 24 horas por defecto, entre 1 y 168.
- Caddy no reenvia `X-Real-IP` ni `X-Forwarded-For` a Node/LiveKit.
- Docker descarta la salida de Caddy, LiveKit y Redis; la aplicación usa el
  driver `local`, comprimido y limitado a tres ficheros de 5 MB.
- Docker no ofrece caducidad por días en ese driver. En Windows,
  `scripts/install-docker-log-retention-task.ps1` programa una auditoría no
  mutante: `scripts/rotate-docker-logs.ps1` informa de límites y antigüedad,
  sin recrear servicios ni interrumpir sesiones. El límite de tamaño no
  garantiza borrado por fecha; una política temporal exige revisar el contenido
  permitido y realizar mantenimiento explícito fuera de las sesiones.
- `SEFER_PRIVACY_LOCAL_PATH` señala una raíz privada externa al repositorio que recibe los
  manifiestos de sesión. Al pasar a `recording`, el backend crea un JSON
  `.local` sin asistentes, alias, voz, IP ni identificadores de sesión; al salir
  de grabación lo completa de forma atómica.
- `SEFER_EXTERNAL_BROADCAST_CHANNELS`, `SEFER_DEPLOYMENT_VERSION` y
  `SEFER_BROADCAST_NOTICE_VERSION` identifican canales y versiones en ese
  manifiesto. La publicación legal activa aporta versión y SHA-256 del aviso.

Ejecute primero la comprobación no mutante:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/rotate-docker-logs.ps1 -DryRun
```

## PWA de audiencia y control

`/audience` y `/control` pueden instalarse como PWA con manifests separados:
`static/manifest.webmanifest` mantiene `start_url` y `scope` en `/audience`,
y `static/control-manifest.webmanifest` mantiene `start_url` y `scope` en
`/control`. Ambos solicitan `/api/branding/logo.svg`: el override de la
instalación tiene prioridad y `src/assets/branding/logo.svg` queda como fallback
neutral. Los activos de branding ya no pertenecen a `public/`.

El service worker `static/audience-sw.js` sirve ambos scopes. Cachea:

- shell minimo de audiencia/control con estrategia network-first;
- TSV biblicos bajo demanda;
- assets extra listados por la instancia mediante
  `SEFER_DATA_DIR/config/audience-cache-assets.txt`.

El archivo privado acepta una ruta publica por linea y comentarios con `#`.
El service worker obtiene la lista mediante `/api/audience-cache-assets` con
`no-store`. La plantilla neutral de esa lista vive en
`examples/SeferPrivateData/config/`. No
se cachean endpoints vivos (`/api/*`, SSE, `/ws`, `/rtc/*`, LiveKit/tokens),
documentos `/legal/*` ni videos/audios pesados. La ruta `/proteccion-datos` y el
Markdown legal usan red con `no-store`: si no hay red no se presenta una
política obsoleta como vigente. Si hay una actualizacion de service worker
esperando, el boton de reinicio de la PWA la activa antes de recargar, sin
borrar nick, respuestas de quiz ni estado local persistente.

Los cinco sonidos técnicos neutrales están en `static/audio/sounds/` y admiten
caché HTTP de siete días. `THIRD_PARTY_NOTICES.md` identifica los tres efectos
procedentes de Pixabay; `bip.mp3` y `silence.ogg` son archivos generados para el
proyecto.

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

### iPhone: audio normal y activacion de media

Safari/iOS puede bloquear `play()` remoto hasta que el usuario toque la pantalla
y suele ignorar `HTMLMediaElement.volume`. La audiencia muestra un boton
`Activar audio y video` cuando detecta ese bloqueo para desbloquear audio,
video y timeline sincronizada desde un gesto explicito. Solo en iPhone, la
musica normal se descarga y decodifica como `AudioBuffer`, con fuentes de un
solo uso recreadas para play, pause y seek. Esto permite volumen y autoduck por
`GainNode`; su salida pasa por `MediaStreamAudioDestinationNode` a un `<audio>`
oculto para conservar una sesion multimedia al bloquear la pantalla, sin
enrutar el archivo por `MediaElementAudioSourceNode`, que puede producir audio
entrecortado. Android, iPad y escritorio conservan el reproductor nativo. Si la
salida stream, descarga o decodificacion falla, iPhone vuelve al destino Web
Audio directo o al `<audio>` nativo, segun el punto de fallo.

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
- `docs/privacy/README.md`: separacion entre documentacion tecnica/plantillas
  versionables y adaptaciones privadas `*.local.*` de cada operador.

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
- `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`: perfil tecnico claro enviado solo a
  Controles autorizados con `participantId`, preferencia de visibilidad y clave
  publica. El alias viaja exclusivamente dentro de `PRIVATE_CONTROL_SIGNAL`.
- `LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE` /
  `LIVE_AUDIO_EXTERNAL_BROADCAST_STATE`: declaracion manual `off/live/recording`
  de un Control autorizado. Cada cambio a directo o grabacion revoca permisos
  de microfono anteriores y exige una nueva confirmacion antes de publicar voz.
  Si se configura una raíz local, la transición a `recording` también inicia un
  manifiesto técnico no nominativo y la salida de ese estado lo finaliza.

La audiencia muestra la misma imagen viva del presenter, sin controles de navegacion ni apertura del panel de control.

Las respuestas detalladas y puntuaciones exactas del quiz permanecen en el
navegador Audience y se separan por presentacion. El servidor transforma cada
aporte en contadores agregados, conserva solo hashes de identificadores
independientes por pregunta o resultado para evitar duplicados y nunca entrega
a Control respuestas individuales, alias o un historial enlazable. En una
diapositiva de resultados, Audience recalcula localmente y aporta solo su rango
para la revision solicitada. El servidor no publica estadísticas hasta reunir
al menos tres aportes en el ámbito correspondiente.

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
La lista visible de participantes activos se cifra dentro de
`PRIVATE_CONTROL_SIGNAL`; los permisos para ver la lista viajan como estado
tecnico claro y no dependen de desencriptar la propia lista.

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
VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT=false
SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE=true
# Allow participants who initially join with a public profile
# to view the active public participant list by default.
SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES=false
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_NODE_IP=
LIVEKIT_NODE_IP_AUTO_DETECT=false
LIVEKIT_LOGGING_LEVEL=warn
LIVEKIT_ROOM_NAME=sefer-live-audio
VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS=24
SEFER_PRIVACY_LOCAL_PATH=../SeferPrivateData/audit
SEFER_EXTERNAL_BROADCAST_CHANNELS=
SEFER_DEPLOYMENT_VERSION=unversioned
SEFER_BROADCAST_NOTICE_VERSION=broadcast-notice-v1
```

Endpoints:

- `GET /api/health`: comprueba que el backend responde, sin depender de LiveKit.
- `GET /api/livekit/status`: devuelve `{ enabled, available?, reason? }` tras
  comprobar la API de LiveKit con timeout y una caché breve. No demuestra que
  los clientes reciban audio; ICE y reproducción requieren una prueba real.
- `POST /api/livekit/token`: entrada Audience `{ role, roomSession? }`; Control
  añade `controlSessionId`. Devuelve `livekitUrl`, `token`, `expiresAt`,
  `participantIdentity`, `participantId` efímero y `refreshCredential` rotatorio.
  Audience recibe permisos mínimos. Control exige Basic Auth y una sesión WS
  autorizada; Presenter exige Basic Auth.
- `POST /api/livekit/refresh-token`: renueva un token para un participante activo
  mediante `{ participantId, refreshCredential }`, preserva la identidad y rota
  la credencial en cada éxito. Los roles privilegiados vuelven a demostrar su
  autorización; credenciales ajenas, expiradas o reutilizadas se rechazan.
- `POST /api/livekit/grant-speak`, `revoke-speak`, `mute-participant`,
  `mute-all`, `kick-participant`, `rescue-participant`: requieren
  Basic Auth, `role: "control"` y un `controlSessionId` autorizado por WebSocket.
  `audience` recibe 403. `rescue-participant` devuelve al usuario expulsado a
  audiencia activa muda (`LISTENER`) sin abrir ni publicar microfono.

### Recuperación de Live Audio

El cliente reintenta las caídas de red con espera creciente y un máximo de ocho
intentos. No reintenta automáticamente una expulsión, una denegación de acceso
o un fallo administrativo del permiso de micrófono. Si el backend ha perdido
el registro o ha caducado la sesión, solicita una nueva admisión validada; no
restaura permisos de hablar a partir de datos enviados por Audience. Una sesión
nueva comienza escuchando y requiere activar el micrófono explícitamente.

La conexión de la aplicación y la de LiveKit se muestran por separado. Control
solo ofrece conceder palabra cuando el cliente informa de conexión de audio;
el servidor confirma además la operación en LiveKit. Un error de captura no
cierra la escucha. Silenciar cancela también una publicación pendiente, y el
modo música recrea solamente la pista de micrófono.

Compose publica UDP `50000–50050` y el fallback ICE/TCP `7881`; el host y el
router deben permitir los mismos puertos. Las redes que solo admiten HTTPS
requieren TURN/TLS con dominio, certificado y puerto propios, según la
[documentación de LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/).

Para servidores con IP pública dinámica, el actualizador DDNS debe confirmar
la IP en `SEFER_DATA_DIR/tmp/hostinger-ddns/last-confirmed-ip`. El vigilante
opcional del host compara esa confirmación, DNS público y la IP anunciada por
LiveKit. Solo actúa tras dos muestras estables, con espera entre recuperaciones;
respeta servicios detenidos y configuraciones de IP fija o LAN. Reinicia
únicamente LiveKit, sin reconstruir la aplicación ni conceder micrófonos.
No necesita montar el socket de Docker en un contenedor.
El lanzador privado puede iniciar el vigilante oculto después de levantar Compose.
El intervalo DDNS debe ser corto; la caché DNS y las dos muestras consecutivas
siguen introduciendo una espera antes de recuperar la IP anunciada.

```powershell
node scripts/watch-livekit-network.mjs --check
node scripts/watch-livekit-network.mjs
```

`--check` es de solo lectura. El vigilante conserva eventos de una lista
cerrada bajo la raíz privada de datos, sin IP, tokens ni datos de asistentes.
Una caída completa del host o de su conexión interrumpe el audio: la recuperación
no sustituye una segunda infraestructura independiente.

Las puntuaciones del quiz permanecen en cada navegador dentro de su TTL local.
Un marcador técnico privado de sesión, válido durante 24 horas, distingue un
reinicio del proceso de un cierre explícito. Reiniciar la aplicación conserva
la sesión vigente; `RESET_STATE`, logout y expiración siguen limpiando los datos.
Las contribuciones anónimas se conservan localmente y se reenvían con los mismos
identificadores al reconectar, para reconstruir los agregados en RAM sin sumar
dos veces. Los totales solo se recuperan con los dispositivos que vuelven a
conectarse y conservan sus datos; no existe un respaldo servidor de respuestas
individuales.

Antes de la primera actualización de un servidor que ya tiene una sesión
abierta, ejecuta `scripts/seed-presentation-session.mjs` con `--url` apuntando
al WebSocket de ese backend y `--data-dir` a la misma raíz privada que usará
la aplicación. Así el primer arranque conserva el identificador vigente.
El script admite únicamente un backend local y no imprime el identificador.
Tras un reinicio completo, Control debe volver a seleccionar la misma
presentación: la proyección y el temporizador continúan siendo volátiles.
Los envíos anteriores a la cola nueva no disponen de IDs persistidos para
una reconstrucción automática segura.

No hay endpoints de consentimiento, alias legible ni chat legible. El backend no
acepta alias en perfiles o snapshots operacionales y no persiste claves, alias,
tokens ni mensajes privados en archivos o base de datos. El snapshot operacional
vive solo en memoria y contiene exclusivamente estado tecnico y agregados de
quiz; no contiene texto privado, respuestas individuales ni alias legibles.

## Voice Scripture opcional

Voice Scripture detecta referencias explícitas del corpus instalado desde una única pista
local o remota de Live Audio, las valida contra la metadata instalada y proyecta
automáticamente la última referencia inequívoca al finalizar una intervención.
Control conserva las alternativas manuales. El operador selecciona o deselecciona el icono de micrófono delante del nick;
el aro amarillo indica la fuente. La escucha permanece activa al cerrar los paneles.
Presenter y Audience no
ejecutan STT. No hay LLM, fallback cloud, diarización, grabación ni historial.

- Build: `VITE_SEFER_VOICE_SCRIPTURE_BUILD=false` excluye el chunk Voice del
  build base.
- Runtime: `SEFER_VOICE_SCRIPTURE_ENABLED=false` evita conexión y procesamiento.
- Estado: `GET /api/voice-scripture/status` devuelve solo
  `{ enabled, available, debug }`.
- Diagnóstico: `SEFER_VOICE_SCRIPTURE_DEBUG=true` activa temporalmente la traza
  de consola descrita en la documentación; puede incluir transcripciones y
  aliases privados, por lo que debe permanecer apagada fuera de una investigación.
- Realtime: Control obtiene por Basic Auth una capacidad efímera de un solo uso;
  `/voice-scripture/ws` la recibe como subprotocolo, exige origen válido, limita
  a una sesión y mantiene la clave del STT exclusivamente en backend.

La instalación nativa, el overlay opcional, el protocolo, privacidad, patrones
V1/V2, decisión sobre Go y resultados del piloto Nemotron/Docker se documentan
en [`docs/VOICE_SCRIPTURE.md`](docs/VOICE_SCRIPTURE.md). El benchmark comparativo
con Whisper y la prueba térmica sostenida siguen pendientes.

Compose monta `SEFER_DATA_DIR` como directorio en `/app/data` y conserva copias
de recuperación fsync de `presentations.json` y `audio_sync.json` en el volumen
`sefer_backups`. El montaje de directorio permite mantener el `rename` atomico
del primario; el fallback in-place solo se usa si el sistema de ficheros lo
impone y después de crear una copia durable.

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
- Con build/runtime Voice habilitados: seleccionar una sola fuente, activar,
  comprobar un final y su proyección automática confirmada por el servidor;
  probar alternativas manuales y repetir con STT apagado.
- Abrir `/audio-editor` y guardar mapas de audio.
- Abrir `/audience` en movil o viewport movil y verificar que no hay controles.

## Notas de mantenimiento

- Los datos generados del operador viven en `SEFER_DATA_DIR/public/books/` y
  solo cambian cuando cambia el origen configurado; el build comprueba su hash.
- Mantener telemetria de media/display en canales ligeros.
- Preferir utilidades compartidas en `src/utils/` antes de duplicar parsing o normalizacion.
- Mantener la pantalla de proyeccion liviana y la audiencia aun mas ligera.
