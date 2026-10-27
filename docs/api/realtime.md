# Contratos realtime y asíncronos

La explicación de autoridad/recuperación está en
[sincronización](../architecture/synchronization.md). Esta página concentra la
sintaxis y los límites. Fuentes: [sync](../../src/types/sync.ts),
[audio](../../src/types/audio.ts), [Live Audio](../../src/types/liveAudio.ts),
[WS servidor](../../server/ws-server.mjs),
[validación backend de mensajes](../../server/ws-message-validation.mjs),
[vistas técnicas de participantes](../../server/ws-participant-snapshots.mjs),
[validación cliente](../../src/utils/validation.ts),
[useSyncState](../../src/hooks/useSyncState.ts) y consumidores de cada feature.

## Transportes y envelopes

`/ws?role=control|presenter|audience` usa JSON y autorización de upgrade.
Control registra controlSessionId; nuevos Controls pueden quedar PENDING.
WELCOME incluye clientId, serverTimeMs, role, presentationSessionId, accessMode
y, para Control, controlSessionId/controlState. Control/Presenter reciben además
operatorCredential: el cliente la conserva en memoria y la borra al cerrar socket.
Estos campos runtime exceden la forma mínima de WELCOME en sync.ts.

WS admite hasta 512 KiB por mensaje entrante. El límite habitual es 64 KiB;
solo `REMOTE_COMMAND` de selección de presentación por Control autorizado y
`SYNC_STATE` de Control autorizado o Presenter pueden superarlo, con una
presentación válida. Los datos ajenos a la presentación no pueden exceder
64 KiB y los mensajes grandes tienen una profundidad máxima de 128 objetos
o arrays desde la raíz. Los excesos y mensajes grandes no elegibles se cierran
con código 1009. El receptor puede ensamblar hasta 512 KiB antes de comprobar
el tipo del mensaje.

La salida usa un presupuesto independiente de 512 KiB por conexión. Todos los
envíos JSON, incluidos `broadcastWs`, snapshots, WELCOME, reloj y errores de
acceso, comprueban OPEN y suman `bufferedAmount`, los bytes UTF-8 serializados y
la cabecera de la nueva trama sin máscara antes de enviarla. Un broadcast se
serializa una sola vez. El exceso cierra solo al destinatario afectado con
1013; un fallo de serialización cierra con 1011 y un fallo de escritura termina
la conexión. Todos reutilizan la limpieza idempotente existente. Los pings del
heartbeat y las respuestas pong también comprueban el presupuesto antes de
escribirse; la respuesta pong conserva el payload del ping. Las tramas de cierre
siguen a cargo de `ws`.

Cada servidor WS posee un heartbeat de 25 segundos, retirado junto con su
listener de upgrade al cerrar. Los códigos pendientes pierden su temporizador
al autorizar, rechazar, desconectar, promocionar o rotar sesión. La limpieza de
participantes conserva la gracia de rejoin; sus callbacks comprueban la identidad
del registro y sus temporizadores se cancelan al reconectar, eliminar, rotar o
cerrar. El heartbeat retira tickets SSE caducados sin modificar su validez de
30 segundos ni su consumo de un uso. Una transición de emisión que espera a
LiveKit vuelve a comprobar la conexión y autorización del Control antes de aplicar
el resultado; desconexión, rotación y cierre invalidan la operación pendiente.

No hay prioridades ni cola de aplicación: si no cabe una actualización de estado,
señal privada o mensaje de moderación, se cierra la conexión en vez de omitirlo
silenciosamente. La reconexión autenticada permite recuperar el estado vigente;
no garantiza replay de señales privadas ni recepción de mensajes anteriores.
JSON malformado, tipos no permitidos y determinados payloads inválidos se descartan;
otras denegaciones emiten `{ type: 'ERROR', code, message }`.
No hay un ACK genérico ni retransmisión persistente para todos los mensajes.

Los constructores cliente añaden protocolVersion=1, timestamp y messageId.
El validador admite metadata omitida por compatibilidad y rechaza versiones
presentes incompatibles. El WS backend no ejecuta exhaustivamente ese validador:
no convertir sus comprobaciones en una garantía uniforme servidor.

SSE usa eventos `data:` con JSON, más `data: heartbeat` cada 30 segundos.
STATE/QUIZ Audience controlada necesita tickets distintos de un uso.
BroadcastChannel local `sefer-presenter` complementa sincronización de pestañas;
no transporta las señales Live Audio dedicadas.

## Estado, permisos y dirección

| Familia | Productor → consumidor | Guard / efecto |
| --- | --- | --- |
| REMOTE_COMMAND | Control autorizado → backend/reducer → displays | Aplica payload soportado y publica SYNC_STATE |
| SYNC_STATE | Backend → Control/Presenter/Audience; entrada legacy operador → backend | Audience recibe slide activa; entradas administrativas autorizadas |
| AUDIO/VIDEO/DISPLAY_TELEMETRY | Operador elegible → backend → consumidores sync | Observación del medio; no concede autoridad |
| AUDIO_SYNC_MAPS_UPDATE | Guardado backend → SSE operador → clientes | Actualiza mapas; no transporta audio |
| REQUEST_STATE | Solicitud cliente según transporte → respuesta/snapshot | No asumir que todas las variantes del tipo son cases directos de WS |
| WELCOME, PRESENTATION_SESSION_ROTATED | Backend → clientes | Identidad, conexión y nueva sesión; consumidores invalidan estado asociado |
| MEDIA_MASTER_STATUS | Backend → Controls | masterControlSessionId/hasActivePresenter; autoridad de reproducción distinta de micrófono |
| SERVER_TIME_PING/PONG | Cliente ↔ backend | clientSentAtMs y serverTimeMs; estimación RTT/offset |
| AUDIO_TIMELINE_ACTION/STATE | Control autorizado → timeline → clientes | Estado canónico de timeline |
| AUDIO_PRESENTATION_CLOCK | Backend → clientes de timeline | timelineId, estimatedPositionSec, serverTimeMs |
| ERROR | Backend → cliente solicitante | Código/mensaje técnico; no todos los descartes producen ERROR |

`stateEpoch` y `stateRevision` son campos runtime de snapshots y telemetría,
aunque no estén en SyncStatePayload/SyncProtocolMeta. El consumidor aplica un gate
para rechazar revisiones antiguas/iguales, épocas retiradas y rollback no versionado
tras estado canónico. BroadcastChannel no puede sustituir por sí solo una época
servidor. Esto ordena snapshots recibidos; no garantiza orden total de comandos,
entrega exactamente una vez ni recuperación de estado persistido.

## Comandos de proyección

La tabla de sintaxis al final se extrajo de RemoteCommandPayload. La enforcement
está en [reducer](../../server/projection-state-reducer.mjs) y sus validadores;
el productor es App/main-control y Voice usa SCRIPTURE_PROJECT existente.
La consecuencia observable es un snapshot de backend, no una promesa de ACK
dedicado por comando. RESET_STATE con clearSession requiere que persista el
nuevo límite de sesión; el fallo no debe describirse como reset exitoso.

## Timeline

El estado incluye timelineId/version, presentación/pista/mapa, status,
basePositionSec/baseServerTimeMs, playbackRate, volume, durationSec, loop,
syncMode, activeCueIndex/nextCueIndex y updatedBy. Se define en audio.ts.
SET_TRACK normaliza identificadores vacíos y volumen; SET_DURATION acota la
posición y looping; autoduck modifica salida local y preserva volumen canónico.

El WS acepta acciones de Control autorizado; las acciones internas del servidor
pueden actualizar duración/end/cues por otros recorridos. Los clientes de
[useAudioTimeline](../../src/hooks/useAudioTimeline.ts) corrigen deriva mediante
[utilidades](../../src/utils/audioTimeline.ts). No documentar sincronía audible
perfecta: el dispositivo y autoplay limitan la reproducción.

## Admisión y política de sesión

Estos mensajes runtime no están todos incluidos en BroadcastMessage:

| Mensaje | Campos significativos | Dirección / permiso |
| --- | --- | --- |
| AUDIENCE_ACCESS_BIND | credential | Audience → servidor; enlaza registro de acceso, separado de identidad Live Audio |
| AUDIENCE_ACCESS_REQUEST | participantId | Audience → servidor; la solicitud de alias va cifrada por canal privado |
| AUDIENCE_ACCESS_LEAVE | Sin payload adicional requerido | Audience → servidor; vuelve a gate en modo controlado |
| AUDIENCE_ACCESS_DECISION | participantId, decision: ADMIT/REJECT/BLOCK/UNBLOCK | Control autorizado → servidor |
| SESSION_ACCESS_POLICY_UPDATE | accessMode: PUBLIC/CONTROLLED | Solo principal → servidor |
| SESSION_ACCESS_POLICY | presentationSessionId, accessMode, updatedAt | Servidor → clientes |
| AUDIENCE_ACCESS_STATE | presentationSessionId, accessMode, participantId, accessState, retryAt?, eventId | Servidor → Audience afectada |
| AUDIENCE_ACCESS_REQUEST | participantId, requestedAt | Servidor → Controls autorizados; no alias legible |
| AUDIENCE_ACCESS_DECISION_RESULT | participantId, decision, decidedByControlSessionId, decidedAt | Servidor → Controls autorizados |

Consumidores: [useAudienceAccess](../../src/hooks/useAudienceAccess.ts),
[AudienceAccessGate](../../src/components/audience/AudienceAccessGate.tsx) y
Control Live Audio/admisión. El cambio de política invalida tickets/streams;
pasar a CONTROLLED conserva admitidos con alias previamente señalado, y devuelve
anónimos al gate. BLOCK de admisión no equivale a KICK de publicación LiveKit.

## Live Audio: autorización, perfiles y snapshots

Tipos exactos en la tabla de sintaxis al final. Productores y consumidores:
[Control](../../src/components/control/ControlParticipationOwner.tsx),
[Audience](../../src/hooks/useAudienceParticipation.ts),
[useControlAuthorization](../../src/hooks/useControlAuthorization.ts) y
WS servidor; moderación utiliza además la [API HTTP](http.md#live-audio-tokens-y-moderación).

Los grupos son estado técnico/counts; grant/revoke/mute/kick/rescue; clave pública
y autorización de Controls; perfil/permisos/lista visible; external broadcast;
solicitud/snapshot/patch operacional; y PRIVATE_CONTROL_SIGNAL.
PENDING no recibe snapshots ni señales privadas y no puede moderar. La autorización
y sucesión pertenecen al servidor, no al perfil comunicado por el cliente.

El código temporal mostrado identifica una solicitud para comparación humana.
La decisión envía `targetControlSessionId` y `APPROVE`/`REJECT`, sin devolver el
código para cotejo. El servidor exige emisor elegible, target pendiente y código
no caducado; no acredita que una persona haya comparado los códigos.

`LIVE_AUDIO_CONNECTION_COUNTS` cuenta sockets abiertos Audience/Control/Presenter,
incluidos Controls pendientes. Se publica a Control y Presenter, sin Audience;
su `updatedAt` se genera en cada construcción. El snapshot operacional reutiliza
esos recuentos, pero conserva su autorización y sus destinatarios propios.

LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE permite participantId, sharing preference,
activeListPublicKey y createdAt opcional. **alias es inválido**. El servidor
verifica vínculo del participante; UUID válido por sí solo no basta.
Snapshot/patch operacional admite datos técnicos y agregados; rechaza campos
sensibles. LIVE_AUDIO_REQUEST_ALIASES no contiene aliases legibles: puede limitar
destinatarios con targetParticipantIds; sin lista no vacía se distribuye a Audience.
La respuesta legible solo existe dentro de ciphertext para Control.

La declaración off/live/recording es una acción de Control autorizado. Cada cambio
a live/recording crea una revisión y revoca grants antes de confirmar; los clientes
deben confirmar publicación para esa revisión. No detecta ni controla OBS.
Los manifiestos privados de grabación pertenecen a otro flujo, no al mensaje WS.

## Señales privadas: envelope y payload descifrado

El envelope PUBLICO es:
`{ type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId, toControlSessionId?,
toParticipantId?, keyId, ephemeralPublicKey, ciphertext, nonce, createdAt? }`.

Audience solo envía desde su UUID vinculado a WS; el backend valida base64,
ciphertext ≤4096 bytes, nonce de 12 bytes y límite de cinco mensajes/minuto.
Controls autorizados pueden dirigirse a Audience o emitir a Controls autorizados
sin destinatario; este broadcast incluye al emisor. La validación cliente admite
ese envelope existente también cuando el emisor usa su controlSessionId.
El servidor no descifra el payload. Consumers crypto derivan ECDH P-256/AES-GCM
256 y mantienen rechazo de nonce repetido en memoria; una rotación de clave
exige renegociación y descarta operaciones pendientes de la generación anterior.

Dentro del ciphertext existen contratos propios, no nuevos tipos WS:
ACTIVE_PROFILE/ACTIVE_STATE/REQUEST_WORD/ACCESS_REQUEST, AUDIO_FALLBACK y mensajes privados hacia Control;
VISIBLE_ACTIVE_PARTICIPANTS y CHAT_RESPONSE hacia Audience;
CONTROL_PROFILE, CONTROL_MICROPHONE_CONFIG, CONTROL_ANNOUNCEMENT y
MESSAGE_REPLY_SYNC y CONTROL_CONVERSATION_MESSAGE entre Controls. Sus campos y guards están en los propietarios
anteriores y [usePrivateControlSignals](../../src/hooks/usePrivateControlSignals.ts).

Especialmente:
- VOICE_SOURCE_SELECTION: `{ type, participantId: string|null, version: 1, updatedAt: number }`;
  allowlist de campos y pertenencia cifrada al grupo Control actual; sincroniza selección, no PCM.
- VOICE_SCRIPTURE_SYNC: `{ type, options, detail, phase }`; sugerencias/estado
  transitorios; el principal produce y los secundarios consumen.
- CONTROL_PROFILE: alias, volume, musicMode y mediaParticipantId opcional; este último
  asocia el ID RTC con el emisor controlSessionId, sin convertirlo en identidad social.
- CONTROL_MICROPHONE_CONFIG: targetParticipantId y volume/musicMode opcionales;
  el destinatario actual aplica su configuración.
- MESSAGE_REPLY_SYNC: replyId, messageId, targetParticipantId, responseText,
  repliedBy, repliedAt y audienceQueued; todos dentro del ciphertext. El receptor
  exige una señal cifrada con la clave compartida de Controls. El messageId de un
  mensaje legacy recibido es JSON.stringify([keyId, fromParticipantId, nonce]) del
  envelope original, igual para todos los Controls; no depende del reloj local.
  Se exige coincidencia exacta de mensaje, participante y keyId. replyId identifica
  la operación para aplicar una sola vez tanto el eco como un reenvío recifrado;
  no sustituye el rechazo criptográfico de nonce repetido. Correlaciones ausentes,
  desconocidas o de otra clave se ignoran, sin buscar por participante.

La respuesta CHAT_RESPONSE a Audience y su sincronización a Controls informan
resultados de envío separados. Un booleano positivo solo acredita aceptación por
el WebSocket local, sin ACK de recepción ni de aplicación. Un fallo de Audience
conserva el borrador; la sincronización no se emite como mensaje WS en claro.
Las respuestas desde la fila de admisión usan access-<participantId> y no se
adjuntan a mensajes de ese participante ni crean un historial de admisión.
Mensajes y respuestas no se reconstruyen de snapshots ni se persisten. Los
Controls deben ejecutar el mismo candidato: los IDs locales anteriores y payloads
sin replyId no proporcionan correlación segura para esta sincronización.

Las conversaciones nuevas usan `conversationId = JSON.stringify([presentationSessionId,
participantId])` y `operationId = crypto.randomUUID()` (UUID v4). PRIVATE_MESSAGE y
CHAT_RESPONSE conservan sus campos anteriores y añaden operationId, conversationId,
presentationSessionId y replyTo opcional; PRIVATE_MESSAGE añade createdAt. replyTo
referencia una operación exacta, nunca «el último mensaje del participante».

CONTROL_CONVERSATION_MESSAGE contiene version=1, operationId, conversationId,
presentationSessionId, participantId, text, operator, createdAt, replyTo opcional y
audienceQueued. Solo se aplica desde el grupo E2EE autorizado, en sesión/clave vigente.
Texto no vacío ≤1000 caracteres, operator ≤80 y fecha entero seguro; el productor de
Control limita además bytes antes de cifrar. IDs repetidos conservan identidad/contenido
inmutables; solo actualizan resultados locales. El compositor de Control produce
operaciones nuevas sin replyTo. Los eventos de equipo con replyTo no crean otra
tarjeta: las respuestas contextuales se aplican por MESSAGE_REPLY_SYNC, con la
coincidencia exacta descrita arriba.

Control conserva el cuerpo de PRIVATE_MESSAGE y sus respuestas verdes solo en el
modelo de Notificaciones. useControlConversations conserva solo las operaciones
nuevas hacia Audience y sus resultados; no duplica los cuerpos entrantes ni mantiene
una línea de historial oculta. El replyTo validado de Audience se conserva en el
mensaje entrante, incluso si su operación original todavía no llegó a ese Control;
no se muestra un historial resuelto. No se cambia el ID ni se asocia al último mensaje.
Los IDs descartados se conservan sin el cuerpo entrante hasta cambiar sesión/clave
o perder autorización. Reencriptar una operación descartada no la vuelve a mostrar;
esto es distinto del rechazo criptográfico de un nonce repetido.

El Control emite CHAT_RESPONSE con la clave del destinatario y un evento separado
con la clave compartida del equipo, usando el mismo operationId. Cada escritura
puede fallar por separado. audienceQueued/controlsQueued son resultados internos:
no se renderizan banners de éxito, solo fallos contextuales. audienceQueued no demuestra entrega; recibir el evento
del equipo tampoco demuestra que Audience lo recibió. No hay ACK, reintento automático,
persistencia, replay histórico ni backfill. Nick del operador es atribución del
grupo de confianza, no firma criptográfica individual.

La iniciación exige estado técnico conectado/activo/no kicked, un perfil técnico
LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE recibido en vivo (su handler servidor exige
admisión) y un perfil E2EE actual que confirme la misma clave. requestAliases permite
obtener ambos sin mensaje previo. Un snapshot antiguo o un ACTIVE_PROFILE cifrado
aislado no acreditan admisión. Rechazo, desconexión, revocación y cambio de clave/sesión
invalidan esas confirmaciones. El backend conserva sus envelopes y rutas existentes;
no interpreta estos campos descifrados. Clientes antiguos muestran CHAT_RESPONSE y
pueden escribir PRIVATE_MESSAGE sin metadatos, pero no comparten los nuevos eventos
ni ofrecen su correlación. MESSAGE_REPLY_SYNC sigue rechazando referencias desconocidas.

Otros payloads emitidos por los clientes actuales:

| type | Campos además de type | Productor → consumidor |
| --- | --- | --- |
| ACTIVE_PROFILE / ACTIVE_STATE / REQUEST_WORD | alias; el refresh de perfil añade isAliasVisibleToActiveParticipants y speakerState LISTENER/REQUESTED/GRANTED | Audience → Control |
| ACCESS_REQUEST | alias | Gate Audience → Control; solicitud técnica de admisión viaja aparte |
| PRIVATE_MESSAGE | text, alias opcional | Audience/gate → inbox de Control |
| AUDIO_FALLBACK | state ACTIVE/REQUESTED/GRANTED, note | Audience tras reconexión fallida → Control |
| VISIBLE_ACTIVE_PARTICIPANTS | participants: string[], updatedAt | Control → Audience con permiso de lista |
| CHAT_RESPONSE | text, senderNick, timestamp | Control → Audience destinataria |
| CONTROL_ANNOUNCEMENT | text, senderNick, timestamp | Control → otros Controls |

Los consumidores comprueban formas parciales por familia: filtran strings de
la lista, normalizan alias/volumen y descartan texto vacío. VoiceSourceSelection
exige version=1 y updatedAt entero seguro positivo; ignora selecciones más antiguas
y desempata igualdad por ID del emisor. VoiceScriptureSync exige phase string,
con defaults locales para options/detail. No hay un schema runtime exhaustivo
único para todos los payloads descifrados. La variante legacy `message` y
`content` se tolera en algunos consumers, sin política formal de deprecación.

No confundir validación del envelope por servidor con aplicación de cada schema
descifrado por cliente; no hay replay histórico duradero ni orden total común
entre estos payloads.

`ALIASES_SYNC` es además un evento local sintetizado por usePrivateControlSignals
al descifrar los aliases transferidos durante autorización de Control; su forma
es `{ type: 'ALIASES_SYNC', aliases }`. No se presenta como un tipo WS autónomo.

## Quiz por SSE/HTTP

Los cuatro envíos, schema de aggregate snapshot, auth, deduplicación y umbral
se definen en [HTTP](http.md#quiz). El servidor distribuye aggregate snapshots
solo al stream administrativo; la Audience no recibe respuestas individuales de
otros usuarios. [useQuizAnswers](../../src/hooks/useQuizAnswers.ts) es productor
de contribuciones y consumidor de snapshots según rol.

## Voice Scripture: WS dedicado

`/voice-scripture/ws` conecta cliente sesión → gateway Node → STT local.
Origen permitido y capacidad de un uso o Basic válido; una sesión activa o
conectando por proceso. Upgrade: 401 autenticación, 409 ocupado, 503
configuración/upstream indisponible. [HTTP](http.md#voice-scripture) emite capacidad.

La comprobación de origen admite requests sin header Origin; cuando existe,
contrasta SEFER_ALLOWED_ORIGINS o el origen derivado del host/protocolo.

El cliente envía session.update, frames binarios PCM16 mono 16 kHz de 320 ms,
y input_audio_buffer.commit al stop manual. Consume
conversation.item.input_audio_transcription.delta como observación y
conversation.item.input_audio_transcription.completed como final; error detiene.
Campos session/transcript/event_id exactos en
[voiceScriptureSession](../../src/features/voiceScripture/voiceScriptureSession.ts).
El gateway reenvía frames/eventos; no aplica el parser de referencias.

session.update declara sample_rate=16000, language=es-ES,
automatic_punctuation=true, endpointing_ms=1000 y speech_contexts con phrases/boost=2.5.
delta exige delta string no vacío; completed exige transcript y event_id strings.

Gateway: frame máximo 512 KiB, colas 256 KiB, handshake upstream cinco segundos.
El cliente deduplica 512 finales recientes, cancela resultados al parar/cambiar
fuente y valida corpus antes de SCRIPTURE_PROJECT. Las demás cotas están en
[feature](../features/voice-scripture.md); no se promete latencia ni precisión
general a partir de tests simulados.

## Sintaxis de los tipos vigentes

Las tablas siguientes capturan la sintaxis declarada en el checkout. Los guards,
campos adicionales y límites runtime anteriores siguen siendo necesarios.
Los tipos enlazados y su implementación son la fuente de actualización.

### RemoteCommandPayload

Fuente: [src/types/sync.ts](../../src/types/sync.ts). Los tipos referenciados siguen definidos en el módulo fuente.

| Variante | Forma declarada |
| --- | --- |
| `SELECT_STEP` | `{ command: 'SELECT_STEP'; stepIndex: number }` |
| `SELECT_PRESENTATION_AND_SLIDE` | `{ command: 'SELECT_PRESENTATION_AND_SLIDE'; presentation: Presentation \| null; slideIndex: number; direction?: 'forward' \| 'backward'; targetVerse?: string }` |
| `TOGGLE_APP_MODE` | `{ command: 'TOGGLE_APP_MODE'; mode: AppMode }` |
| `TOGGLE_BG_LOCK` | `{ command: 'TOGGLE_BG_LOCK'; locked: boolean }` |
| `SELECT_BG_OVERRIDE` | `{ command: 'SELECT_BG_OVERRIDE'; bg: string \| null }` |
| `QUIZ_START_TIMER` | `{ command: 'QUIZ_START_TIMER' }` |
| `QUIZ_PAUSE_TIMER` | `{ command: 'QUIZ_PAUSE_TIMER' }` |
| `QUIZ_RESUME_TIMER` | `{ command: 'QUIZ_RESUME_TIMER' }` |
| `QUIZ_RESET_TIMER` | `{ command: 'QUIZ_RESET_TIMER' }` |
| `QUIZ_ADJUST_TIMER` | `{ command: 'QUIZ_ADJUST_TIMER'; seconds: number }` |
| `QUIZ_COMPLETE` | `{ command: 'QUIZ_COMPLETE' }` |
| `QUIZ_RECALCULATE_RESULTS` | `{ command: 'QUIZ_RECALCULATE_RESULTS'; slideIds: string[] }` |
| `QUIZ_CLEAR_QUESTION_RESULTS` | `{ command: 'QUIZ_CLEAR_QUESTION_RESULTS'; slideId: string }` |
| `QUIZ_SELECT_SUBSLIDE` | `{ command: 'QUIZ_SELECT_SUBSLIDE'; index: number }` |
| `QUIZ_DEMO_SELECT` | `{ command: 'QUIZ_DEMO_SELECT'; optionId: string \| null }` |
| `QUIZ_PLAY_APPLAUSE` | `{ command: 'QUIZ_PLAY_APPLAUSE' }` |
| `QUIZ_PLAY_MAL` | `{ command: 'QUIZ_PLAY_MAL' }` |
| `SCRIPTURE_PROJECT` | `{ command: 'SCRIPTURE_PROJECT'; state: SeferReaderState; navCommand?: 'navigate' \| 'next' \| 'previous' }` |
| `SCRIPTURE_ADD_SLIDE` | `{ command: 'SCRIPTURE_ADD_SLIDE'; state: SeferReaderState; kind?: 'tanaj' \| 'sefer' }` |
| `SCRIPTURE_BOUNDARY` | `{ command: 'SCRIPTURE_BOUNDARY'; direction: 'next' \| 'previous' }` |
| `SCRIPTURE_ESCAPE` | `{ command: 'SCRIPTURE_ESCAPE' }` |
| `SCRIPTURE_ARROW_NAV` | `{ command: 'SCRIPTURE_ARROW_NAV'; direction: 'up' \| 'down' }` |
| `UPDATE_FONT_SIZES` | `{ command: 'UPDATE_FONT_SIZES'; hebrewFontSize?: number; combinedTextBaseSize?: number }` |
| `VIDEO_STATE_CHANGE` | `{ command: 'VIDEO_STATE_CHANGE'; state: VideoState \| null }` |
| `AUDIO_STATE_CHANGE` | `{ command: 'AUDIO_STATE_CHANGE'; state: AudioState }` |
| `SET_AUTODUCK_STATE` | `{ command: 'SET_AUTODUCK_STATE'; state: AutoduckState }` |
| `RESET_STATE` | `{ command: 'RESET_STATE'; clearSession?: boolean; hardRefresh?: boolean }` |

### BroadcastMessage

Fuente: [src/types/sync.ts](../../src/types/sync.ts). Los tipos referenciados siguen definidos en el módulo fuente.

| Variante | Forma declarada |
| --- | --- |
| `SYNC_STATE` | `({ type: 'SYNC_STATE' } & SyncStatePayload & SyncProtocolMeta)` |
| `AUDIO_TELEMETRY` | `({ type: 'AUDIO_TELEMETRY'; clientId: string; origin: 'control' \| 'presenter'; audioState: AudioState } & SyncProtocolMeta)` |
| `VIDEO_TELEMETRY` | `({ type: 'VIDEO_TELEMETRY'; clientId: string; origin: 'control' \| 'presenter'; videoState: VideoState \| null } & SyncProtocolMeta)` |
| `DISPLAY_TELEMETRY` | `({ type: 'DISPLAY_TELEMETRY'; clientId: string; origin: 'control' \| 'presenter' } & DisplayTelemetryState & SyncProtocolMeta)` |
| `AUDIO_SYNC_MAPS_UPDATE` | `({ type: 'AUDIO_SYNC_MAPS_UPDATE'; maps: unknown[] } & SyncProtocolMeta)` |
| `REQUEST_STATE` | `({ type: 'REQUEST_STATE'; clientId?: string } & SyncProtocolMeta)` |
| `REMOTE_COMMAND` | `({ type: 'REMOTE_COMMAND'; clientId: string; payload: RemoteCommandPayload } & SyncProtocolMeta)` |
| `WELCOME` | `({ type: 'WELCOME'; clientId: string; serverTimeMs: number; role?: 'presenter' \| 'control' \| 'audience' \| 'unknown'; presentationSessionId?: string } & SyncProtocolMeta)` |
| `PRESENTATION_SESSION_ROTATED` | `({ type: 'PRESENTATION_SESSION_ROTATED'; presentationSessionId: string; hardRefresh?: boolean } & SyncProtocolMeta)` |
| `SERVER_TIME_PING` | `({ type: 'SERVER_TIME_PING'; clientSentAtMs: number } & SyncProtocolMeta)` |
| `SERVER_TIME_PONG` | `({ type: 'SERVER_TIME_PONG'; clientSentAtMs: number; serverTimeMs: number } & SyncProtocolMeta)` |
| `AUDIO_TIMELINE_ACTION` | `({ type: 'AUDIO_TIMELINE_ACTION'; action: AudioTimelineAction } & SyncProtocolMeta)` |
| `AUDIO_TIMELINE_STATE` | `({ type: 'AUDIO_TIMELINE_STATE'; timeline: AudioTimelineState } & SyncProtocolMeta)` |
| `AUDIO_PRESENTATION_CLOCK` | `({ type: 'AUDIO_PRESENTATION_CLOCK'; timelineId: string; estimatedPositionSec: number; serverTimeMs: number } & SyncProtocolMeta)` |
| `LiveAudioBroadcastMessage` | `(LiveAudioBroadcastMessage & SyncProtocolMeta)` |
| `ERROR` | `({ type: 'ERROR'; code: string; message: string } & SyncProtocolMeta)` |

### AudioTimelineAction

Fuente: [src/types/audio.ts](../../src/types/audio.ts). Los tipos referenciados siguen definidos en el módulo fuente.

| Variante | Forma declarada |
| --- | --- |
| `SET_TRACK` | `{ type: 'SET_TRACK'; presentationId: string; audioSrc: string; syncMapId?: string; syncMode?: AudioSyncMode; volume?: number }` |
| `PLAY` | `{ type: 'PLAY'; positionSec?: number }` |
| `PAUSE` | `{ type: 'PAUSE' }` |
| `SEEK` | `{ type: 'SEEK'; positionSec: number }` |
| `SET_RATE` | `{ type: 'SET_RATE'; rate: number }` |
| `SET_VOLUME` | `{ type: 'SET_VOLUME'; volume: number }` |
| `SET_DURATION` | `{ type: 'SET_DURATION'; durationSec: number \| null }` |
| `SET_LOOP` | `{ type: 'SET_LOOP'; loop: boolean }` |
| `SET_SYNC_MODE` | `{ type: 'SET_SYNC_MODE'; mode: AudioSyncMode }` |
| `END` | `{ type: 'END'; positionSec?: number }` |
| `STOP` | `{ type: 'STOP' }` |

### LiveAudioBroadcastMessage

Fuente: [liveAudio.ts](../../src/types/liveAudio.ts). Snapshot anidado: LiveAudioOperationalSnapshot en ese módulo.

| Variante | Campos declarados |
| --- | --- |
| `LIVE_AUDIO_PARTICIPANT_STATUS` | `type: 'LIVE_AUDIO_PARTICIPANT_STATUS'; participantId: string; role: LiveAudioParticipantRole; operationalRole?: LiveAudioOperationalRole; microphonePermissionState?: MicrophonePermissionState; microphoneTrackState?: MicrophoneTrackState; liveAudioConnectionState?: LiveAudioConnectionState; speakerState: SpeakerState; controlState?: ControlPrincipalState \| ControlSecondaryState; canSubscribe: boolean; canPublishAudio: boolean; isMuted?: boolean; isActiveAudience?: boolean; isMicrophoneActive?: boolean; isKicked?: boolean; isAliasVisibleToActiveParticipants?: boolean; canViewActiveParticipants?: boolean; isAliasHiddenByControl?: boolean; activeListPublicKey?: string; connected?: boolean; updatedAt?: number;` |
| `LIVE_AUDIO_CONNECTION_COUNTS` | `type: 'LIVE_AUDIO_CONNECTION_COUNTS'; totalConnections: number; audienceConnections: number; controlConnections: number; presenterConnections: number; updatedAt?: number;` |
| `LIVE_AUDIO_GRANT_SPEAK` | `type: 'LIVE_AUDIO_GRANT_SPEAK'; participantId: string; issuedByParticipantId?: string; createdAt?: number;` |
| `LIVE_AUDIO_REVOKE_SPEAK` | `type: 'LIVE_AUDIO_REVOKE_SPEAK'; participantId: string; issuedByParticipantId?: string; createdAt?: number;` |
| `LIVE_AUDIO_MUTE_PARTICIPANT` | `type: 'LIVE_AUDIO_MUTE_PARTICIPANT'; participantId: string; issuedByParticipantId?: string; createdAt?: number;` |
| `LIVE_AUDIO_MUTE_ALL` | `type: 'LIVE_AUDIO_MUTE_ALL'; issuedByParticipantId?: string; excludeParticipantIds?: string[]; createdAt?: number;` |
| `LIVE_AUDIO_KICK_PARTICIPANT` | `type: 'LIVE_AUDIO_KICK_PARTICIPANT'; participantId: string; issuedByParticipantId?: string; createdAt?: number;` |
| `LIVE_AUDIO_RESCUE_PARTICIPANT` | `type: 'LIVE_AUDIO_RESCUE_PARTICIPANT'; participantId: string; issuedByParticipantId?: string; createdAt?: number;` |
| `LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION` | `type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION'; participantId: string; canViewActiveParticipants: boolean; createdAt?: number;` |
| `LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY` | `type: 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY'; participantId: string; isAliasHiddenByControl: boolean; createdAt?: number;` |
| `LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT` | `type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT'; participantId: string; createdAt?: number;` |
| `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE` | `type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE'; participantId: string; activeListPublicKey: string; isAliasVisibleToActiveParticipants: boolean; createdAt?: number;` |
| `LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION` | `type: 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION'; participantId: string; canViewActiveParticipants: boolean; createdAt?: number;` |
| `LIVE_AUDIO_CONTROL_PUBLIC_KEY` | `type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY'; controlSessionId: string; keyId: string; publicKey: string; createdAt?: number;` |
| `LIVE_AUDIO_CONTROL_JOIN_REQUEST` | `type: 'LIVE_AUDIO_CONTROL_JOIN_REQUEST'; controlSessionId: string; verificationCode: string; recipientPublicKey?: string; createdAt?: number;` |
| `LIVE_AUDIO_CONTROL_AUTHORIZED` | `type: 'LIVE_AUDIO_CONTROL_AUTHORIZED'; controlSessionId: string; authorizedByControlSessionId: string; keyId?: string; sessionPublicKey?: string; transferPublicKey?: string; encryptedSessionPrivateKey?: string; nonce?: string; encryptedAliases?: string; aliasesNonce?: string; createdAt?: number;` |
| `LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE` | `type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE'; controlSessionId: string; controlState: LiveAudioControlState; principalControlSessionId?: string; verificationCode?: string; codeExpiresAt?: number; allowDelegatedModerators: boolean; pendingControls?: PendingControlAuthorization[]; updatedAt?: number;` |
| `LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION` | `type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION'; targetControlSessionId: string; decision: 'APPROVE' \| 'REJECT'; issuedByControlSessionId?: string; createdAt?: number;` |
| `CONTROL_KEY_ROTATED` | `type: 'CONTROL_KEY_ROTATED'; keyId: string; publicKey?: string; controlSessionId?: string; reason?: 'CONTROL_ROTATION' \| 'NO_AUTHORIZED_CONTROLS'; createdAt?: number;` |
| `PRIVATE_CONTROL_SIGNAL` | `type: 'PRIVATE_CONTROL_SIGNAL'; fromParticipantId: string; toControlSessionId?: string; toParticipantId?: string; keyId: string; ephemeralPublicKey: string; ciphertext: string; nonce: string; createdAt?: number;` |
| `LIVE_AUDIO_REQUEST_ALIASES` | `type: 'LIVE_AUDIO_REQUEST_ALIASES'; targetParticipantIds?: string[]; createdAt?: number;` |
| `LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE` | `type: 'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE'; state: LiveAudioExternalBroadcastState; createdAt?: number;` |
| `LIVE_AUDIO_EXTERNAL_BROADCAST_STATE` | `type: 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE'; state: LiveAudioExternalBroadcastState; revision: number; updatedAt: number;` |
| `LIVE_AUDIO_SNAPSHOT_REQUEST` | `type: 'LIVE_AUDIO_SNAPSHOT_REQUEST'; controlSessionId?: string; createdAt?: number;` |
| `LIVE_AUDIO_SNAPSHOT` | `type: 'LIVE_AUDIO_SNAPSHOT'; snapshot: LiveAudioOperationalSnapshot; createdAt?: number;` |
| `LIVE_AUDIO_SNAPSHOT_PATCH` | `type: 'LIVE_AUDIO_SNAPSHOT_PATCH'; snapshot: Partial<LiveAudioOperationalSnapshot>; createdAt?: number;` |
