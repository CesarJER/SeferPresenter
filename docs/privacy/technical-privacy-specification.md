# Especificación técnica de privacidad de SeferPresenter

Versión: 2026-07-31  
Ámbito: comportamiento común del producto auditado.  
No contiene decisiones ni datos de un operador concreto.

## 1. Clasificación

- **Siempre cierta:** deriva del diseño actual y no depende de configuración.
- **Predeterminada pero configurable:** existe un valor por defecto modificable.
- **Dependiente del despliegue:** cambia por infraestructura o variables.
- **Dependiente del operador:** requiere una decisión organizativa.
- **Función opcional:** solo existe cuando se habilita el módulo.
- **Pendiente de implementar:** requisito identificado pero no garantizado.

## 2. Arquitectura y roles técnicos

| Componente | Función | Datos principales | Clasificación |
| --- | --- | --- | --- |
| Presenter | Proyección, multimedia, telemetría y estado | Presentación, índice, estado de medios | Siempre cierta |
| Control | Comandos, edición, moderación y autorización | Estado, alias E2E, permisos, mensajes descifrados | Siempre cierta |
| Audience | Recepción, quiz y Live Audio opcional | Sesión, progreso local, alias/voz si participa | Siempre cierta |
| Node HTTP/SSE | API, estado y quiz | Estado, contadores agregados, contenido | Siempre cierta |
| WebSocket | Sincronización, Control y señales privadas | IDs técnicos, permisos y ciphertext | Siempre cierta |
| LiveKit | SFU de voz y tokens | Identidad seudónima, permisos y pistas | Función opcional |
| Caddy | TLS y proxy | IP, cabeceras, dominio y ruta | Dependiente del despliegue |
| Redis | Coordinación LiveKit sin persistencia configurada | Estado efímero | Función opcional |
| OBS/plataforma | No forma parte del producto | Captura y publicación decididas externamente | Dependiente del operador |

Evidencia principal: `src/App.tsx`, `src/main-control.tsx`,
`src/main-audience.tsx`, `server/local-server.mjs`, `server/ws-server.mjs`,
`server/livekit-server.mjs`, `docker-compose.yml` y `Caddyfile`.

## 3. Identificadores

| Identificador | Creación | Ubicación | Ciclo de vida | Clasificación |
| --- | --- | --- | --- | --- |
| `clientId` | Navegador | RAM navegador/servidor | Página/conexión | Siempre cierta |
| `presentationSessionId` | Servidor | Marcador técnico privado de 24 h y envoltura caducable en `localStorage` Audience | Rotación/logout/expiración | Siempre cierta |
| `submissionId` de quiz | Navegador; uno por aporte y ámbito | Envoltura caducable local, tránsito y hash en RAM servidor | Presentación/limpieza/expiración | Siempre cierta |
| `participantId` | Servidor/WS | RAM WS, cliente y LiveKit | Conexión/reentrada | Función opcional |
| `controlSessionId` | Control | RAM cliente/WS | Autorización/conexión | Función opcional |
| identidad LiveKit | Servidor | JWT, RAM y SFU | TTL y gracia | Función opcional |

Son seudónimos, no datos anónimos, mientras permitan distinguir o correlacionar
una sesión o participante.

## 4. Almacenamiento del navegador

### `localStorage`

Se usa para:

- estado de sincronización/proyección y preferencias;
- referencia de sesión e identidad local Audience (alias y visibilidad) en envolturas caducables;
- respuestas, puntuaciones y contribuciones pendientes/reenviables locales del quiz;
- estado de Control y otros ajustes operativos.

Evidencia: `src/hooks/useSyncState.ts:226-241`,
`src/hooks/useAudienceSession.ts:20-71`,
`src/hooks/useQuizAnswers.ts:101-160` y
`src/hooks/useSeferControlLogic.ts:35-99`.

La referencia de sesión, las respuestas, las puntuaciones y las contribuciones Audience usan
envolturas versionadas con TTL de 24 horas por defecto, configurable entre 1 y
168 horas. Lectura expirada, formato legado/malformado, logout y rotación purgan
los valores de forma idempotente. Alias y visibilidad comparten una envoltura
caducable vinculada a la referencia de sesión y nunca sobreviven a su expiración.
Las claves antiguas sin TTL se purgan. Logout se sincroniza entre instancias y
pestañas mediante eventos locales y de storage. El estado operativo de Presenter/Control no se considera identidad de
Audience y conserva su ciclo funcional propio.

### `sessionStorage`

Conserva visibilidad y reaparición del panel de Live Audio dentro de la pestaña.
Evidencia:
`src/features/liveAudio/components/audience/AudienceLiveAudioPanel.tsx`.

### Cache Storage

El service worker cachea shells y activos estáticos. Excluye API, WebSocket,
tokens, LiveKit, documentos legales y medios pesados mediante reglas explícitas.
`/proteccion-datos` y `/legal/*` se solicitan con `no-store`; el backend añade
también cabeceras HTTP `no-store`. Sin red, el producto muestra indisponibilidad
en vez de presentar una política almacenada como si siguiera vigente.
Evidencia: `public/audience-sw.js:65-83,138-216`.

### Cookies e IndexedDB

No se encontró uso de `document.cookie` ni de la API IndexedDB en el código de
producto auditado. No debe declararse que se usan sin nueva evidencia.

## 5. Alias y participación

### Comportamiento actual

Audience solicita un alias al pasar a participación activa. El cliente envía
`LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE` solo con `participantId`, visibilidad y
clave pública. El alias se entrega a Controles autorizados dentro de
`PRIVATE_CONTROL_SIGNAL`, cifrado E2E. Node valida y enruta el ciphertext sin
recibir el alias legible y rechaza un perfil claro que incluya `alias`.

Evidencia:

- `LiveAudioAudienceContainer.tsx`;
- `server/ws-server.mjs`;
- `src/hooks/usePrivateControlSignals.ts:144-274`.

### Lista voluntariamente visible

Las señales privadas distribuyen una lista de alias autorizados. Control puede
conceder a un Audience **activo** permiso para visualizarla. El Audience pasivo
permanece con `isActiveAudience=false`, no tiene alias y queda fuera de cola,
oradores y audiencia activa en la interfaz de Control. Por tanto, el Audience
pasivo usado como fuente de OBS no dispone de la ruta normal de interfaz para
recibir esa lista.

El servidor rechaza expresamente el permiso si el destinatario no es Audience
activo con perfil y clave pública. Un test de regresión cubre el intento manual
contra un Audience pasivo.

Clasificación:

- alias privado E2E: **verificado en código y tests; pendiente de tráfico controlado**;
- visibilidad voluntaria a otros Audience: **función opcional**;
- salida OBS mediante Audience pasivo sin alias: **verificada en flujo y prueba
  negativa del servidor**.

## 6. Mensajes privados

Los mensajes `PRIVATE_CONTROL_SIGNAL` usan ECDH P-256, HKDF y AES-256-GCM,
además de TLS. El servidor enruta ciphertext y aplica validación/anti-replay.
Los Controles autorizados pueden descifrar.

Evidencia: `src/utils/cryptoUtils.ts:13-129`,
`src/hooks/usePrivateControlSignals.ts:144-274` y
`server/ws-server.mjs:708-742`.

Clasificación: **siempre cierta para el canal privado auditado**, sin extender la
afirmación a alias enviados por otras rutas.

## 7. Live Audio

Live Audio es opcional. Node emite JWT temporales para una sala configurada,
mantiene credenciales/permisos en RAM y solicita a LiveKit cambios de
moderación.

El cliente se conecta con `autoSubscribe: false` y se suscribe manualmente a
todas las publicaciones de audio, no a vídeo. El micrófono se publica solo tras
una acción local mediante `getUserMedia`/LiveKit. Control puede retirar permiso
o silenciar, pero no activar el micrófono físico.

Evidencia: `server/livekit-server.mjs:101-205,252-432` y
`src/features/liveAudio/hooks/useLiveAudio.ts:354-390,469-526,614-655`.

La voz usa cifrado WebRTC en tránsito. No se configuró E2EE de medios frente al
SFU. No se encontró LiveKit Egress ni escritura de audio en disco.

## 8. Quiz

### Cliente

El navegador valida respuestas según el contenido recibido, calcula progreso y
guarda respuestas/puntuaciones localmente.

### Servidor actual

Los mensajes contienen únicamente aportes agregables y un `submissionId`
distinto por pregunta, resultado de pregunta o solicitud de resultado final.
Node incrementa contadores y conserva en RAM solo hashes acotados por ámbito
para evitar duplicados. Control recibe opciones/citas/rangos agregados, nunca
`displayName`, respuestas individuales, puntuaciones exactas ni un identificador
estable que permita reconstruir el recorrido de una persona.
Las distribuciones permanecen ocultas para Control hasta reunir al menos tres
aportes en el ámbito correspondiente.

Evidencia: `src/hooks/useQuizAnswers.ts`,
`server/quiz-message-validation.mjs` y `server/local-server.mjs`.

Persisten como requisitos separados la purga local por TTL y tratar un futuro
voto o decisión como una función distinta con evaluación propia.

Clasificación: agregación exclusiva **verificada en código y tests; pendiente
de ejecución controlada multidispositivo**.

## 9. Persistencia de servidor

| Dato | Persistencia | Observación |
| --- | --- | --- |
| Presentaciones | JSON y copias `.bak` | Contenido del operador |
| Mapas de audio | JSON y copias | Contenido operativo |
| Estado de proyección | RAM | Se pierde al reiniciar salvo contenido persistido |
| Quiz | Detalle en navegador; agregados y hashes acotados en RAM servidor | Control no recibe detalle; umbral de tres |
| Participantes/Controles | RAM | Existen snapshots durante la sesión |
| Tokens/credenciales LiveKit | RAM | TTL/gracia configurables |
| Redis | Sin snapshot ni AOF en Compose | Perfil opcional |
| Marcador de sesión | Archivo privado con UUID de sesión y caducidad de 24 h | Distingue reinicio del proceso de cierre explícito; no contiene participantes |
| Logs app | Docker `local`, 5 MB × 3, comprimido | Allowlist operativa; auditoría sin reinicios |
| Logs Caddy/LiveKit/Redis | Driver Docker `none` | No se persisten porque pueden contener IP/ICE/JWT |

Evidencia: `server/persistence.mjs`, `server/local-server.mjs`,
`server/ws-server.mjs`, `server/livekit-server.mjs` y `docker-compose.yml`.

## 10. Red, IP y logs

Caddy termina TLS pero elimina `X-Real-IP` y `X-Forwarded-For` antes de los
upstream. Node no lee IP ni `User-Agent` en el código de producto. Compose
descarta completamente la salida de Caddy, LiveKit y Redis; solo conserva logs
operativos allowlist de la aplicación mediante el driver `local` acotado.

LiveKit puede detectar la IP pública de salida del **servidor**, no de Audience,
cuando falta `LIVEKIT_NODE_IP`, pero solo si
`LIVEKIT_NODE_IP_AUTO_DETECT=true`. El mecanismo consulta dos endpoints HTTPS
permitidos, valida la respuesta IPv4 y falla de forma segura si está desactivado
o recibe un valor inválido.

Docker no ofrece retención por edad en sus drivers `local`/`json-file`. El script
`rotate-docker-logs.ps1` audita límites y antigüedad sin detener ni recrear
contenedores. La antigüedad de un contenedor no demuestra la de sus registros.
La tarea opcional del host ejecuta esta auditoría en modo no mutante.
Los límites de tamaño y número de ficheros no garantizan un plazo de borrado;
una política temporal estricta requiere una solución de logging revisada o
mantenimiento explícito fuera de las sesiones.

El vigilante opcional `watch-livekit-network.mjs` consulta la IP de salida del
servidor, la confirmación de DDNS y DNS público. Solo actúa sobre el contenedor
LiveKit tras confirmar estabilidad y aplica espera entre recuperaciones. Sus
registros privados contienen eventos de una lista cerrada, sin direcciones,
credenciales ni identificadores de participantes, y tienen retención acotada.

## 11. Grabación y salida Audience pasiva

SeferPresenter no contiene OBS, Egress ni integración de grabación. Una captura
externa es dependiente del operador.

Cuando un operador capture un Audience pasivo, el producto debe preservar que:

- no pueda pasar a Audience activo ni recibir lista sin realizar el flujo de
  alias/participación;
- no muestre alias ni lista de participantes mientras siga pasivo;
- no muestre mensajes privados o diagnósticos identificativos;
- exponga un estado declarado de directo/grabación;
- invalide autorizaciones de micrófono previas al cambio de estado;
- mantenga la acción local del usuario;
- emita un manifiesto no nominativo de versión/estado si se configura.

La ausencia de alias en el Audience pasivo está verificada. Un Control autorizado
puede declarar `off/live/recording`; el estado y su revisión se distribuyen a
los clientes. Cada transición a directo o grabación revoca permisos previos,
cierra pistas locales y exige confirmación explícita antes de volver a publicar
voz. Es una declaración manual y no prueba ni controla el estado real de OBS.
El backend inicia un manifiesto JSON `.local` al entrar en `recording` y lo
completa atómicamente al pasar a `live` u `off`. Incluye fecha de inicio/fin,
canales configurados, versión de software, versión del aviso, ruta/versión/hash
de la política, comprobaciones y resultado. Excluye asistentes, alias, voz, IP,
quiz e identificadores de sesión. La ubicación se monta desde la raíz local
ignorada; no es un mensaje WS ni se publica a clientes.

## 12. Configuración de privacidad

Variables relevantes:

- `SEFER_LIVE_AUDIO_ENABLED`;
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`;
- `LIVEKIT_ROOM_NAME`, `LIVEKIT_NODE_IP`;
- `LIVEKIT_NODE_IP_AUTO_DETECT`, opt-in para IP dinámica del servidor;
- `LIVEKIT_LOGGING_LEVEL`;
- `VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS`;
- `SEFER_LOG_CONTAINER_MAX_AGE_HOURS` para el script del host;
- `SEFER_PRIVACY_LOCAL_PATH`, raíz local ignorada para manifiestos;
- `SEFER_EXTERNAL_BROADCAST_CHANNELS`, `SEFER_DEPLOYMENT_VERSION` y
  `SEFER_BROADCAST_NOTICE_VERSION`, metadatos no nominativos del manifiesto;
- secretos y controles de autorización documentados en `.env.example`;
- `SEFER_PRIVACY_LOCAL_PATH` es interpolado por Compose y montado únicamente en
  el backend; no se expone al frontend.

Los datos de organización y proveedores no deben compilarse en el producto
general salvo mediante un paquete legal local explícito y revisado.

### 12.5 Presentación de documentos legales

Las URL fijas `/legal/privacy.md` y `/legal/privacy-summary.md` presentan la
política completa y la tabla de primera capa. El backend las resuelve desde la
secuencia activa del Git anidado `SEFER_DATA_DIR/legal/`, después de validar la
cadena de manifiestos y todos los SHA-256. La ruta física no procede del cliente.

`LegalMarkdown` interpreta Markdown con tablas GFM y componentes visuales
responsivos. El HTML embebido y las imágenes están deshabilitados, por lo que
los documentos locales no pueden inyectar marcado arbitrario ni recursos de
seguimiento mediante esa vía. `/proteccion-datos` presenta el título, versión y
el SHA-256 completo. El aviso breve presenta la tabla antes del enlace a la
segunda capa y muestra la versión y el final del hash; la ruta interna del
fichero no se muestra al usuario en ninguno de los dos lugares.
Si la tabla de primera capa o la política completa no pueden cargarse, el aviso
presenta un error y la barrera de micrófono permanece cerrada.

## 13. Garantías y estado

| Garantía | Estado |
| --- | --- |
| Audiencia pasiva sin alias | Verificada |
| Micrófono apagado y acción local | Verificada en código |
| Control no activa micrófono físico | Verificada por arquitectura |
| Mensajes privados E2E | Verificada en código |
| Todos los alias transportados por el producto E2E | Verificada en código/tests; runtime pendiente |
| Quiz exclusivamente agregado en servidor/Control | Verificada en código/tests; runtime pendiente |
| TTL/purga de sesión y quiz Audience | Verificada en código/tests; navegador real pendiente |
| No persistir logs de proxy/SFU/Redis | Verificado en despliegue Compose |
| Logs app sin IP/campos sensibles | Verificado mediante auditoría allowlist de runtime |
| Máximo temporal de logs | La rotación por tamaño no garantiza borrado por tiempo; auditoría de solo lectura |
| Estado externo declarado reflejado | Implementado; depende de la acción manual del operador |
| Revocación al entrar en directo/grabación | Verificada en código/tests; LiveKit real pendiente |
| Audience pasivo de OBS sin alias/lista | Verificado en flujo y prueba negativa de servidor |
| Fuente legal versionada, renderizada y hash visible | Implementada y verificada en despliegue local |
| Información básica tabular configurable antes de intervenir | Implementada y verificada en DOM/runtime |
| Manifiesto no nominativo de grabación | Implementado, probado y verificado en volumen Compose |

## 14. Revisión

Esta especificación debe actualizarse cuando cambien contratos, mensajes WS,
estado sincronizado, almacenamiento, endpoints, LiveKit, PWA, logs, grabación o
generación de documentos legales.
