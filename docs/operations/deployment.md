# Operación: instalación, configuración y diagnóstico

Referencia self-hosted. Los comandos se ejecutan desde la raíz salvo indicación contraria. Trabaje con datos y entorno autorizados y una copia recuperable. Contratos: [API](../api/README.md); uso: [primera sesión](../guides/first-session.md); tratamiento: [privacidad](../privacy/README.md).

El [idioma predeterminado de interfaz](../development/i18n.md#runtime-and-configuration)
se configura mediante JSON opcional, sin recompilar Vite. Su cambio se lee al
iniciar Node; la implementación i18n no reinicia servicios ni modifica Docker.

## Aplicabilidad y prerrequisitos

Node.js 24 LTS (`24.x`) y npm. Dockerfile usa Node 24 Alpine fijado por digest
en compilación y producción; la CI también utiliza Node 24. Compose añade proxy
y perfiles opcionales. Instale dependencias con `npm ci` en un checkout revisado.
Medios/corpus/secretos pertenecen al operador. Python/Pillow solo para optimización
de imágenes; GPU/modelo/STT solo para Voice Scripture.

Los estilos de Tailwind CSS 4 requieren Safari 16.4+, Chrome 111+ o Firefox 128+.
Las funciones multimedia y opcionales pueden imponer requisitos adicionales;
compruebe la matriz de aceptación en los dispositivos utilizados. El tema y las
utilidades propias viven en `src/index.css`, y PostCSS utiliza `@tailwindcss/postcss`.

Antes de arrancar compruebe rama, HEAD, cambios, puertos y destino de `SEFER_DATA_DIR`. No sobrescriba un `.env` existente con el ejemplo. `.env.example` activa `COMPOSE_PROFILES=live-audio`: déjelo vacío para stack base y configure flags/secretos antes de activar una feature.

## Scripts

```bash
npm run dev          # backend local + servidor Vite frontend
npm run dev:frontend # solo servidor Vite frontend
npm run dev:backend  # backend local Node en http://localhost:8787
npm run docker:up    # Compose: app + Caddy y los perfiles habilitados en el entorno
npm run docker:down  # detener el stack completo de Docker Compose
npm run build        # build web
npm run start:local  # backend local sirviendo dist/
npm run test         # Vitest
npm run lint         # ESLint
npm run generate:scripture # regenerar corpus local de forma explicita
npx tsc -p tsconfig.app.json --noEmit  # tipos de src/
npx tsc -p tsconfig.node.json --noEmit # tipos de vite.config.ts
npm run index:memory # re-indexar grafo AST con codebase-memory-mcp
```

`dev` no genera ni copia el corpus. Antes de cada `build`,
`npm run generate:scripture` compara un SHA-256 combinado del corpus y de
`SEFER_DATA_DIR/config/voice_aliases.json` con
`SEFER_DATA_DIR/config/verses-source.sha256`: regenera si cambian esas entradas
o faltan `metadata.json` o el directorio `books/`. Si falta el origen, muestra una advertencia y el build
continúa sin modificar datos.

`build` y `build:web` ejecutan ese generador mediante sus prehooks y pueden
escribir datos del operador. Los checks de tipos anteriores no lo ejecutan.
El `tsconfig.json` raíz solo contiene referencias; `tsc --noEmit` sin `-p` no
comprueba los proyectos hijos. La configuración actual tampoco habilita `strict`
ni comprueba el backend `.mjs`. `.env.example` activa `COMPOSE_PROFILES=live-audio`:
para un stack base, deje esa variable vacía; para voz, configure antes sus secretos.


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


## Ejecución local y Compose

Si necesitas probar el stack completo con proxy, Redis y LiveKit, activa el
perfil opcional con `docker compose --profile live-audio up --build`. El perfil
requiere `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`. Configure `LIVEKIT_NODE_IP`
de forma expresa. Para servidores con IP dinámica puede habilitar
conscientemente `LIVEKIT_NODE_IP_AUTO_DETECT=true`; el contenedor consulta solo
proveedores HTTPS permitidos, valida una respuesta IPv4 y falla si no obtiene
una válida.
Antes de construirlo, activa tambien `SEFER_LIVE_AUDIO_ENABLED=true` y
`VITE_SEFER_LIVE_AUDIO_BUILD=true` en el entorno.

El servicio monta [config/livekit.yaml](../../config/livekit.yaml) en solo lectura
y arranca LiveKit con `room.auto_create: false`. El backend debe poder invocar
`CreateRoom` y `DeleteRoom` con sus credenciales servidor; los JWT de participantes
solo permiten entrar en su sala. Al emitir/renovar tokens se asegura la sala
vigente, incluida la recuperación de una sala cerrada por inactividad.

En la primera transición desde salas compartidas, actualizar primero el backend
que crea salas explícitamente y aplicar después la configuración del SFU en una
ventana autorizada. Una vez activos ambos, rotar la sesión desde Control para
establecer un UUID nuevo; no borrar el marcador para simular esa operación.
La sala legacy compartida y otras salas creadas antes del cambio requieren revisión
del operador: no se borran automáticamente por prefijo. Preparar estos archivos
no aplica la configuración a un LiveKit que ya está ejecutándose.

Revisar avisos `livekit:room:delete-failed`, `delete-cancelled` y
`create-outcome-uncertain`. Un timeout puede dejar incierto el efecto remoto;
no equivale a confirmación de borrado ni revocación permanente de un JWT.

En Audience, `VITE_SEFER_LIVE_AUDIO_BUILD=false` conserva participación y mensajería
E2EE y excluye solo el adaptador RTC/SDK de su grafo. No necesita token LiveKit para
las acciones sociales. El mismo flag todavía excluye el contenedor actual de
Control; para recibir/responder necesita un Control autorizado con su canal privado
activo. La independencia del propietario Control sigue pendiente. Véase
[comportamiento y límites](../features/live-audio.md).

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

Configure en el `.env` privado:

```dotenv
SEFER_REQUIRE_AUTH=true
SEFER_CONTROL_PASSWORD=<contraseña-del-operador>
```

Después ejecute `npm run start:local` con un build preparado.

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


## Live Audio: configuración y recuperación

### Backend LiveKit self-hosted

El módulo incluye endpoints backend para tokens y moderacion, con estado solo en
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


Los endpoints/permisos están en [HTTP](../api/http.md#live-audio-tokens-y-moderación); Control necesita además credencial operador activa. El bloque enumera configuración: comprobar entorno efectivo y no tratar campos vacíos como servicio listo.

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
la sesión vigente; `RESET_STATE` con clearSession, logout y expiración local
siguen limpiando los datos correspondientes.
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


## Voice Scripture

Requiere flags de build Live Audio/Voice y runtime correspondientes, contraseña Control, URLs STT/readiness y clave local. Interfaces: [HTTP](../api/http.md#voice-scripture) y [realtime](../api/realtime.md#voice-scripture-ws-dedicado). Límites: [feature](../features/voice-scripture.md).

### Runtime nativo reproducible

The engine recorded in the historical pilot was **NeMo-Speech.cpp 0.1.0**, with
an operator-installed Q8 streaming model. For that protocol its endpoint is
`/v1/realtime`. Al cambiar de motor/version, verificar endpoint y contrato usados por launcher y gateway; no asumir compatibilidad con otra ruta realtime.

Set the local secret in `.env` (the launcher reads it without printing it):

```dotenv
SEFER_VOICE_SCRIPTURE_STT_URL=ws://127.0.0.1:9090/v1/realtime
SEFER_VOICE_SCRIPTURE_READY_URL=http://127.0.0.1:9090/ready
SEFER_VOICE_SCRIPTURE_STT_API_KEY=<local-secret>
```

```powershell
node scripts/start-voice-scripture.mjs
# Docker-to-native-host pilot:
node scripts/start-voice-scripture.mjs --host 0.0.0.0
```

The launcher defaults to the sibling `STT_Engine` installation; `--engine` and
`--model` override those paths. It validates the version, refuses an occupied
port and starts with `--endpointing --stop-history-eou-ms 1000`. It does not kill
another process. The runtime key remains an engine process argument as required
by this installed CLI; never print the complete process command line.

For Docker, retain `docker-compose.voice-scripture.yml` and
`host.docker.internal` URLs. Restart only the selected STT service after verifying
its ownership; do not interrupt unrelated services. The model remains outside
the app image. Keep port 9090 restricted to the intended host/container boundary.


## Persistencia y actualización

Compose monta `SEFER_DATA_DIR` como directorio en `/app/data` y conserva copias
de recuperación fsync de `presentations.json` y `audio_sync.json` en el volumen
`sefer_backups`. El montaje de directorio permite mantener el `rename` atomico
del primario; el fallback in-place solo se usa si el sistema de ficheros lo
impone y después de crear una copia durable.


## Verificación, parada y recuperación

Comprobar `/api/health`, acceso Control/Presenter y proyección Audience; con Live Audio comprobar servicio, conexión SFU y recepción audible en otro dispositivo. Un 200 no demuestra el recorrido completo.

Si faltan datos, secreto, corpus esperado o autorización, parar y resolver antes de exponer el servicio. Ante 412 conservar draft y reconciliar revisión; ante 403 de operador reconectar/verificar autorización. Un fallo de captura requiere comprobar permisos sin confundirlos con escucha.

Para actualizar, preservar `.env`, raíz privada y backups; registrar versión/commit/configuración, preparar build/imagen en entorno de validación y programar el cambio fuera de sesiones. El estado vivo es volátil. Restaurar código/imagen solo con datos compatibles; no retroceder publicaciones legales ni borrar activación para forzar rollback. Sin compatibilidad/recuperación comprobada, parar y conservar evidencia.

`npm run deploy` optimiza, genera corpus y usa un override privado hermano: revisar expansión y existencia antes de usarlo en otra instalación. Los ejemplos operativos no autorizan ejecutarlos durante revisión documental.

Retención temporal sin recreación/reinicio: [TODO](../../TODO.md). Evidencia para release/dispositivos: [preparación](../guides/prepare-release.md).

## Legacy

`legacy/` es registro local de desarrollo. No forma parte del producto, no debe ir al build y queda fuera de ESLint.
