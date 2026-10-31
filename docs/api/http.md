# Contratos HTTP

Referencia del backend [local-server](../../server/local-server.mjs),
[autenticación](../../server/authUtils.mjs), [LiveKit](../../server/livekit-server.mjs)
y [gateway Voice](../../server/voice-scripture-server.mjs). Los consumidores principales
son [useSyncState](../../src/hooks/useSyncState.ts),
[admisión](../../src/hooks/useAudienceAccess.ts),
[quiz](../../src/hooks/useQuizAnswers.ts), [catalogApi](../../src/utils/catalogApi.ts)
y las features [audio](../../src/features/liveAudio/) y [voz](../../src/features/voiceScripture/).

## Autenticación y límites comunes

`SEFER_REQUIRE_AUTH` exige Basic Auth salvo valor literal `false`. Las rutas públicas
del middleware tienen guards adicionales cuando procede. Basic compara la contraseña
configurada; no establece por sí sola rol, admisión o permiso de publicación.

En las tablas, **administrativa** significa protegida por Basic cuando auth está
activada. **Operador activo** añade `X-Sefer-Operator-Credential`, obtenido de WELCOME
y vinculado a un WS abierto autorizado; `/api/command` exige Control, estado y
telemetría también admiten Presenter. Sin autoridad: `403 OPERATOR_FORBIDDEN`.
No persistir ni publicar esa credencial.

Audience controlada utiliza `Authorization: Bearer <credencial-audience>`.
EventSource utiliza un ticket de un uso en `?ticket=<ticket>`, distinto de la
credencial. Tokens y otras rutas LiveKit aplican sus propios guards incluso si
la autenticación global está desactivada.

El lector general de bodies limita a 5 MiB; LiveKit utiliza 64 KiB. Esto no
implica idéntico status de error para todas las rutas. Los errores suelen ser
`{ error }`; otras respuestas añaden `code`. No hay un envelope de error único.

## Configuración pública de idioma

`GET /api/public-config` es público y responde con `Cache-Control: no-store` y
`{ "i18n": { "defaultLocale": "es", "supportedLocales": ["es", "en", "fr", "he"] } }`.
Solo expone campos validados de idioma. No devuelve rutas, secretos ni otros
campos del archivo local. Configuración inválida o ausente devuelve el respaldo
español. Véanse [configuración y prioridad de preferencias](../development/i18n.md#runtime-and-configuration).

## Estado, comandos y telemetría

| Método y ruta | Entrada / acceso | Respuesta y efectos |
| --- | --- | --- |
| GET `/api/health` | Pública, sin body | 200 `{ healthy: true }`, no-store; acredita respuesta Node |
| GET `/api/state` | Administrativa | Snapshot canónico completo |
| GET `/api/state-events` | Administrativa, SSE | Snapshot inicial y eventos de operador; conexiones descartadas si falla escritura |
| POST `/api/state` | Operador activo; objeto con `clientId: string`, `slideIndex: number` y estado de proyección | Normaliza, aplica y distribuye estado; 200 `{ success: true }`, 400 si faltan mínimos/JSON inválido |
| POST `/api/command` | Control activo; `{ type: 'REMOTE_COMMAND', clientId, payload }`, payload en [realtime](realtime.md#comandos-de-proyección) | Reduce comando; 200 `{ success: true, state }`; 400 inválido, 403 sin autoridad, 503 `SESSION_PERSISTENCE_FAILED` si falla reset persistido |
| POST `/api/audio-telemetry` | Operador activo; `{ type: 'AUDIO_TELEMETRY', clientId, origin, audioState }` | Actualiza audio espejo y distribuye; 200 success / 400 inválido |
| POST `/api/video-telemetry` | Operador activo; `{ type: 'VIDEO_TELEMETRY', clientId, origin, videoState }` | Video objeto o null; actualiza espejo/distribuye |
| POST `/api/display-telemetry` | Operador activo; type correspondiente, clientId/origin, `backgroundLock: boolean`, dos campos string o null | Actualiza `lockedBackgroundValue`/`userSelectedBackground` y distribuye |

En telemetría HTTP, `clientId` y `origin` son campos emitidos por los clientes,
pero el handler no los exige. Comprueba `type`, datos mínimos de la familia y
que `payload`, si existe, sea string u objeto. La autoridad proviene del guard
de conexión, no del `origin` declarado.

La sintaxis cliente está en [sync.ts](../../src/types/sync.ts),
[audio.ts](../../src/types/audio.ts) y [presentation.ts](../../src/types/presentation.ts).
El handler HTTP de estado comprueba mínimos y normaliza: **no aplica íntegramente
el validador TypeScript del cliente**. Telemetría HTTP comprueba envelope y formas
básicas, no una validación exhaustiva de cada campo anidado. El reducer valida
comandos mediante [projection-state-reducer](../../server/projection-state-reducer.mjs).

## Catálogos, medios y caché

| Método y ruta | Entrada / acceso | Respuesta y efectos |
| --- | --- | --- |
| GET `/api/presentations` | Administrativa | Array de Presentation y ETag; 500 si JSON no válido |
| POST `/api/presentations` | Administrativa; array completo, `If-Match` | Valida/normaliza, persiste y recalcula catálogo público; success y nuevo ETag |
| GET `/api/audio-sync` | Administrativa | Array de AudioSyncMap y ETag |
| POST `/api/audio-sync` | Administrativa; array completo, `If-Match` | Valida/persiste; nuevo ETag y evento SSE `AUDIO_SYNC_MAPS_UPDATE` |
| GET `/api/backgrounds` | Administrativa | URLs de imágenes AVIF/GIF/JPEG/PNG/SVG/WebP y vídeos MP4/WebM del árbol público |
| GET `/api/audio` | Administrativa | URLs MP3/WAV/OGG/M4A/AAC/FLAC/WebM |
| GET `/api/public-catalogs` | Pública | Configuración de catálogos |
| GET `/api/public-catalogs/:id/presentations` | Pública | Array público filtrado por tags; 404 catálogo desconocido |
| GET `/api/public-catalogs/:id/presentations/:presentationId` | Pública | Presentación filtrada; 404 si no pertenece al catálogo |
| GET `/api/audience-cache-assets` | Pública | Array de rutas absolutas públicas; ignora comentarios y líneas inválidas; [] sin archivo |

Los catálogos administrativos utilizan [validadores backend](../../server/content-validation.mjs)
y persistencia de los archivos del operador. El guard ETag compara la revisión
actual: `428` sin If-Match, `412` si es obsoleta; `400` por JSON/schema, `500`
si no puede persistir. Se aceptan tanto el ETag fuerte original como sus variantes
con sufijo `-gzip` o `-zstd` que añade Caddy al comprimir; ambas deben corresponder
al hash actual. No se aceptan ETags débiles, comodines ni listas de revisiones.
El cliente conserva el draft ante error. El backend no fusiona cambios y no
garantiza una transacción distribuida entre procesos.

Ante `412`, los editores comparan la base inmutable de su borrador, el borrador
y una carga nueva validada. Cambios en presentaciones con ID distinto se combinan;
dos cambios del mismo registro, o edición frente a eliminación, requieren elegir
una versión en el comparador. En audio, el registro se identifica por presentación
y pista, también si dos editores crean mapas con IDs diferentes. El orden relativo
de registros existentes se compara por separado; reordenaciones incompatibles
también requieren elección. Las altas concurrentes se conservan en orden servidor/local.
El resultado confirmado, incluidos los cambios ajenos, sustituye la lista local.
Cada intento mantiene `If-Match`; si el servidor cambia durante la revisión se
vuelve a comparar, con un máximo de tres POST por operación. Cancelar o fallar
no confirma el guardado ni sustituye el borrador.

El sincronizador consulta las presentaciones al abrir, cada 15 segundos, al
recuperar foco y antes de guardar. Conserva las filas anteriores si cambian las
diapositivas y exige revisarlas; al aceptar, mueve las marcas por ID estable de
slide, conservando el identificador de versículo. No guarda automáticamente tras
esa revisión. Un fallo de comprobación bloquea el guardado hasta recuperarse.
Esto no constituye una transacción entre ambos catálogos: una presentación puede
cambiar después de la comprobación y antes del POST del mapa. No se persiste un
historial de versiones de las diapositivas dentro de cada mapa.

Para payloads exactos consulte Presentation/Slide en
[presentation.ts](../../src/types/presentation.ts) y AudioSyncMap/AudioSyncCue en
[audio.ts](../../src/types/audio.ts). El array de mapas incluye id, name, audioSrc,
presentationId, cues, defaultSyncMode y defaultVolume; cada cue contiene
timeSec, slideIndex y verse opcional. Compruebe además el validador runtime.

## Admisión de Audience

| Método y ruta | Entrada | Resultado y permisos |
| --- | --- | --- |
| POST `/api/audience/access/bootstrap` | Pública; `{ credential?: string }` | Snapshot de acceso; credencial nueva si no reconoce la anterior; 400 JSON inválido |
| POST `/api/audience/sse-ticket` | Bearer Audience; `{ purpose: 'STATE' \| 'QUIZ' }` | 200 `{ ticket }`; 401 sin admisión/propósito admitido; 400 JSON inválido |
| GET `/api/audience/state` | Pública en modo PUBLIC; Bearer admitido en CONTROLLED | SYNC_STATE reducido a slide activa; 401 si falta admisión |
| GET `/api/audience/events` | SSE; ticket STATE requerido en CONTROLLED | Snapshot inicial reducido y actualizaciones; 401 ticket inválido/expirado |

El bootstrap incluye `presentationSessionId`, `participantId`, `accessMode`,
`accessState`, `retryAt?` y `credential?`. Reutilizar una credencial válida no
la devuelve otra vez. El backend guarda su digest y registro en RAM. Los tickets
caducan a los 30 segundos y se consumen también cuando el propósito no coincide:
solicitar uno nuevo para otra conexión. Rotar sesión o política invalida tickets.

La admisión SSE se comprueba al abrir la conexión. Tras persistir correctamente
una rotación de sesión, el servidor invalida las credenciales y tickets anteriores
y termina las suscripciones Audience STATE y QUIZ antes de publicar el estado
de la nueva sesión. Las suscripciones administrativas se conservan. En modo
CONTROLLED, Audience debe obtener nueva admisión y tickets; en PUBLIC se mantiene
la política de acceso público. Si falla la persistencia antes de completar la
rotación, la sesión y los streams anteriores siguen vigentes.

El cierre impide escribir datos de la sesión nueva al stream retirado; pueden
terminar de llegar bytes de la sesión anterior ya enviados. Esta garantía no
supone revocación de permisos RTC ni solución de otros riesgos de lifecycle.

El cliente conserva la credencial de acceso en `sefer-audience-access` ligada
a la sesión. Este registro tiene un lifecycle distinto de las respuestas con
TTL y del identificador técnico de Live Audio; no afirmar un TTL idéntico
para todo el almacenamiento. El enlace/bind y las decisiones se describen en
[realtime](realtime.md#admisión-y-política-de-sesión).

## Quiz

| Método y ruta | Entrada / acceso | Resultado |
| --- | --- | --- |
| POST `/api/quiz-answer` | Aportes públicos o Bearer admitido en CONTROLLED; clear administrativo con credencial de Control activo y Basic si auth está activa | 200 success; 400 inválido; 401 sin admisión/Basic requerido; 403 OPERATOR_FORBIDDEN para clear sin Control activo; 409 presentación/capacidad/request incompatibles |
| GET `/api/quiz-events` | SSE público; ticket QUIZ en CONTROLLED | Eventos no sensibles; no distribuye el snapshot agregado de Control |
| GET `/api/quiz-control-events` | SSE administrativo | Snapshots agregados y clears |
| POST `/api/quiz-control-state` | Administrativo; `{ presentationId: string }` no vacío | QUIZ_AGGREGATE_SNAPSHOT; 400 JSON/campo inválido |

Cada envío requiere `presentationId`:

| type | Campos adicionales y validación backend |
| --- | --- |
| QUIZ_ANSWER_AGGREGATE | submissionId, slideId, selectedOptionIds: array de IDs, máximo 20 |
| QUIZ_QUESTION_RESULT_AGGREGATE | submissionId, slideId, isCitaCorrect: boolean |
| QUIZ_FINAL_SCORE_AGGREGATE | submissionId, requestId: entero ≥0, rank: entero 1..100 |
| QUIZ_CLEAR_ANSWERS | slideId opcional |

Los identificadores admiten 1..160 caracteres `[A-Za-z0-9._:-]`; claves de objeto
peligrosas se rechazan. La validación y umbral están en
[quiz-message-validation](../../server/quiz-message-validation.mjs).
Los agregados se limitan a la presentación activa, deduplican contributions por
hash de scope/submissionId y ocultan grupos menores de tres. No son una garantía
general de anonimato ni autenticación de una persona única.

`QUIZ_AGGREGATE_SNAPSHOT` contiene type, presentationId, aggregate y updatedAt.
aggregate incluye slides, submittedAnswersBySlideId, finalScoreRanges,
totalFinalScores, minimumGroupSize, finalScoreRequestId y updatedAt.
La reconstrucción tras reinicio depende de contribuciones locales reenviadas
por [useQuizAnswers](../../src/hooks/useQuizAnswers.ts); no hay backup servidor
de respuestas individuales.

QUIZ_CLEAR_ANSWERS es administrativo: comprueba Basic cuando corresponde y
`X-Sefer-Operator-Credential` ligado a un Control autorizado con WS abierto;
no exige también el Bearer de Audience. Esto se aplica con auth global activada
o desactivada. Los aportes siguen comprobando admisión en CONTROLLED.
Control espera success HTTP antes de limpiar localmente/distribuir por canal
local y emitir QUIZ_CLEAR_QUESTION_RESULTS para la proyección. Un rechazo conserva
el agregado local; si cambió la presentación durante la petición, no aplica el
clear ni el comando a la nueva. El clear servidor y el comando de proyección no
son una transacción global. Remediación y límites:
[revisión previa a publicación](../audits/2026-10-08/prepublication-review.md#impl-doc-01-remediación).

## Branding y documento legal

| Método y ruta | Resultado público |
| --- | --- |
| GET `/api/branding/logo.svg` | SVG de operador o neutral; ETag, nosniff, caché siete días |
| GET `/api/branding/favicon.svg` | Mismo criterio |
| GET `/api/branding/welcome.md` | Markdown de operador o neutral; ETag, revalidación a cinco minutos |
| GET `/api/legal/manifest` | 200 manifiesto público/versiones/hashes; 503 `LEGAL_NOT_CONFIGURED`; no-store |
| GET `/legal/privacy.md`, `/legal/privacy-summary.md` | Documentos de publicación activa o plantillas neutrales; no-store |

La fuente legal y sus comprobaciones están en [privacidad](../privacy/README.md).
No se exponen las rutas físicas del operador.

## Live Audio: tokens y moderación

| Método y ruta | Entrada y guard | Resultado |
| --- | --- | --- |
| GET `/api/livekit/status` | Pública | enabled, available?/reason?; chequeo acotado de API; no demuestra recepción de audio |
| POST `/api/livekit/token` | role?, roomSession?, controlSessionId?, audienceAccessCredential? | livekitUrl, token, expiresAt, expiresInMs, participantIdentity, participantId, refreshCredential |
| POST `/api/livekit/refresh-token` | participantId, refreshCredential; Audience añade audienceAccessCredential cuando procede | Misma forma, preserva identidad y rota credencial |
| POST `/api/livekit/grant-speak` | Control autorizado, participantId | Concede publicación de micrófono, estado GRANTED; no abre captura |
| POST `/api/livekit/revoke-speak` | Igual | Quita publicación, estado LISTENER |
| POST `/api/livekit/mute-participant` | Igual; requiere permiso de publicación existente | Silencia pistas de micrófono, conserva GRANTED |
| POST `/api/livekit/mute-all` | Control autorizado, excludeParticipantIds? | Silencia oradores salvo exclusions y Controls; puede completar parcialmente antes de fallo |
| POST `/api/livekit/kick-participant` | Control autorizado, participantId | Revoca publicación, REVOKED/kicked; distinto del bloqueo de admisión |
| POST `/api/livekit/rescue-participant` | Igual | LISTENER sin publicación, sin abrir micrófono |

Bodies de moderación incluyen `role: 'control'`, `controlSessionId` y credencial
operador en header, además de Basic válido. Presenter necesita Basic para token;
Control necesita además WS autorizado coincidente. En token, role omitido o no
reconocido se interpreta como Audience: no inferir permiso privilegiado del input.

La sala deriva exclusivamente del identificador canónico de sesión de presentación.
`roomSession` se acepta por compatibilidad pero se ignora. Antes de emitir o renovar
un JWT, el backend crea explícitamente la sala vigente y vuelve a comprobar sesión,
registro y autorización tras las operaciones asíncronas. Los JWT de participantes
no conceden `roomCreate`. Un fallo de creación devuelve 502 `livekit_unavailable`;
un trabajo de una sesión retirada devuelve 403 `participant_inactive`.

La rotación invalida registros y credenciales de refresh anteriores antes de
programar el borrado de su sala. El borrado usa el nombre antiguo capturado,
timeout RPC de dos segundos y como máximo dos intentos; su fallo no revierte la
sesión nueva. `not_found` cuenta como sala ausente. Los fallos quedan en logs con
nombre técnico, intento y status/code saneados, sin JWT ni credenciales.

Los guards de admisión comprueban Audience antes de emitir/renovar token.
Refresh rechaza participante inactivo (403 participant_inactive), sesión caducada
(401 session_expired), credencial inválida/reutilizada (403 refresh_credential_invalid),
y roles privilegiados sin permiso. La credencial se guarda hasheada y rota por éxito.

Las operaciones administrativas actualizan LiveKit **antes** de confirmar estado
lógico. Participante ausente/no listo: 409 participant_not_ready; sin permiso de
micrófono: 409 publish_permission_required; error SDK: 502 livekit_unavailable.
Durante revocación global: 409 publication_transition_pending.
Desactivación/mala configuración devuelve 503; el catch general devuelve error 500.
No existe atomicidad global de mute-all ni garantía de publicación física a partir
de un success HTTP: comprobar pista y receptor.

## Voice Scripture

| Método y ruta | Guard / respuesta |
| --- | --- |
| GET `/api/voice-scripture/status` | Administrativa; 200 { enabled, available, debug } |
| POST `/api/voice-scripture/token` | Administrativa; misma forma, token/expiresInMs solo cuando available |

La capacidad caduca en 10 segundos y permite un uso. Un 200 sin token expresa
indisponibilidad, no una sesión abierta. La disponibilidad consulta readiness
del STT con timeout de dos segundos. El gateway exige origen permitido y capacidad
válida **o** Basic válido; por ello el token no es la única vía de autenticación
implementada. Contrato dedicado en [realtime](realtime.md#voice-scripture-ws-dedicado).

## Versionado y compatibilidad

Las rutas HTTP no llevan versión de API. No se encontró una política general
implementada de deprecación o retries. ETag, versión del protocolo sync, revisión
de publicación y token TTL resuelven necesidades distintas. Consulte el handler
y su consumidor antes de asumir garantías adicionales.
