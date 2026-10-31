# 0007 — Salas LiveKit acotadas por sesión y desacoplamiento de medios RTC

Estado: Accepted. Decisión arquitectónica implementada y verificada en los hitos P1C, P2E y R3-RTC.
Fecha: 2026-10-31.

## Contexto

El sistema de audio en vivo (Live Audio) utiliza WebRTC a través de un servidor LiveKit SFU self-hosted. En el diseño previo:
1. El nombre de la sala era estático (configurado en `LIVEKIT_ROOM_NAME`, p. ej. `sefer-live-audio`).
2. LiveKit operaba con auto-creación activada por defecto (`room.auto_create: true`).
3. Un cliente que obtuviera un JWT firmado en una sesión de presentación podía reconectarse en una sesión posterior y escuchar o transmitir audio indebidamente.
4. En el frontend, los componentes de presencia social y mensajería privada (E2EE) se encontraban fuertemente acoplados al ciclo de vida del SDK de LiveKit, de modo que si RTC fallaba o no estaba compilado (`VITE_SEFER_LIVE_AUDIO_BUILD=false`), se impedía la interacción social y la mensajería entre operadores y audiencia.

## Decisión

1. **Derivación determinista del nombre de sala exclusivamente en el servidor:**
   El backend deriva el nombre de la sala LiveKit como `${config.roomName}-${presentationSessionId}`, donde `presentationSessionId` se obtiene estrictamente de `presentationSessionStore.getSessionId()`. Cualquier valor enviado por el cliente en el cuerpo de la petición (`body.roomSession`) es completamente ignorado.
2. **Creación explícita y desactivación de auto-creación en el SFU:**
   - El backend gestiona explícitamente el ciclo de vida de la sala en LiveKit mediante `roomServiceClient.createRoom(...)` antes de expedir tokens de acceso.
   - Las solicitudes concurrentes de tokens coalescen sobre una única promesa de creación en vuelo (`pendingRoomCreation`), evitando carreras y llamadas duplicadas al SFU.
   - Si la creación falla (p. ej. SFU no disponible), la petición falla cerrada con HTTP 502 `livekit_unavailable` sin emitir ningún JWT.
   - Se desactiva la auto-creación en LiveKit desplegando `config/livekit.yaml` con `room.auto_create: false`.
3. **Concesiones JWT con privilegios mínimos:**
   Los tokens expedidos a participantes contienen únicamente `roomJoin: true` para la sala de la sesión activa y permisos según su rol (`canPublish: true/false`, `canSubscribe: true`). **Bajo ninguna circunstancia se otorgan privilegios administrativos (`roomAdmin`) ni de creación (`roomCreate`)**.
4. **Eliminación acotada en rotación de sesión:**
   Al rotar la sesión (`onPresentationSessionRotated`):
   - Se invalidan síncronamente los mapas locales en memoria (`participants`, `issuedTokens`, `roomState`).
   - Se espera la resolución de cualquier creación en vuelo antes de solicitar la eliminación remota.
   - Se invoca `roomServiceClient.deleteRoom(roomName, { requestTimeout: 2 })` con reintentos acotados (máximo 2 intentos).
   - Los errores de red o códigos `not_found` se capturan de forma segura y se registran sin abortar la rotación del backend.
5. **Desacoplamiento estricto de participación social y cifrado E2EE:**
   - La presencia social, lista de participantes admitidos y mensajería privada cifrada residen en los propietarios `ControlParticipationOwner` y `AudienceParticipationOwner`, independientes de la infraestructura WebRTC.
   - El adaptador RTC (`LiveAudioControlContainer` / `LiveAudioContainer`) es un componente adaptativo hermano, montado condicionalmente bajo un Suspense/error boundary propio.
   - En Control, el adaptador está indexado con `key={presentationSessionId}`, garantizando que cualquier rotación desmonte limpiamente `useLiveAudio`, detenga las pistas de audio y desconecte la sala SFU sin perturbar las conversaciones de texto ni la presencia.
   - En Audience, los eventos de reconexión con `sessionChanged` incrementan la generación e invalidan credenciales obsoletas de audio.

## Alternativas consideradas

- **Reutilizar sala estática y expulsar participantes vía `RemoveParticipant`:** Rechazada porque es inherentemente propensa a carreras de concurrencia y no impide que un cliente con un token aún válido temporalmente vuelva a conectarse a la misma sala.
- **Permitir que el cliente proponga el identificador de sala:** Rechazada de plano por violar el principio de autoridad única del servidor y permitir que clientes maliciosos accedan o creen salas arbitrarias.
- **Encapsular la mensajería privada en DataChannels de LiveKit:** Rechazada porque ataría la comunicación textual de soporte a la disponibilidad y carga de WebRTC, obligando además a incluir el pesado SDK de LiveKit en clientes de solo texto.

## Consecuencias y límites

- **Garantías verificadas:**
  - Aislamiento de la nueva sala respecto a tokens anteriores mediante derivación determinista del nombre por UUID de sesión.
  - La presencia social y el chat E2EE continúan operando con normalidad aunque LiveKit no esté disponible, se caiga o esté desactivado en el build.
  - La rotación de sesión en el backend no se bloquea si el SFU está inaccesible para la llamada de eliminación.
- **Límites y comportamiento en fallo de DeleteRoom:**
  - **Fallo de eliminación remota:** Si la llamada RPC `DeleteRoom` falla o la red hacia el SFU se interrumpe durante la rotación, el backend registra el fallo (`livekit:room:delete-failed`) y no bloquea ni revierte la rotación local. En ese escenario degradado, la sala anterior permanece activa en el SFU hasta que expire por su timeout de inactividad (`emptyTimeout: 300`).
  - **Alcance del token anterior frente a nueva sala:** Un JWT expedido para la sesión anterior no puede bajo ninguna circunstancia unirse a la nueva sala (cuyo nombre contiene el nuevo UUID de sesión). Sin embargo, si la sala anterior no pudo eliminarse en el SFU, un participante en posesión de un token previo no expirado podría continuar conectado o reconectarse a dicha sala residual antigua mientras siga viva.
  - **Dependencia estricta de la configuración del SFU:** LiveKit no revoca criptográficamente firmas JWT descentralizadas; la garantía de que un token viejo no pueda forzar la recreación de una sala eliminada descansa exclusivamente en que el SFU esté ejecutando con `room.auto_create: false` efectivo.
  - **Verificación operativa pendiente:** La validación completa de esta denegación de conexión contra el binario SFU real en ejecución con `config/livekit.yaml` montado permanece como un hito de aceptación de despliegue operativo que no puede ser certificado únicamente mediante suites de pruebas automatizadas locales.

## Seguridad e implicaciones operativas

- Mitiga el riesgo de filtración o cruce de audio entre sesiones de presentación sucesivas.
- El orden de despliegue en producción es crítico: primero debe desplegarse el backend (con creación explícita de salas), seguido de la configuración de LiveKit (`room.auto_create: false`) y el reinicio del contenedor SFU, evitando rechazos accidentales de salas válidas.

## Evidencia y relaciones

- Implementación en [`server/livekit-server.mjs`](../../server/livekit-server.mjs), [`config/livekit.yaml`](../../config/livekit.yaml), [`docker-compose.yml`](../../docker-compose.yml) y [`src/components/control/ControlParticipationOwner.tsx`](../../src/components/control/ControlParticipationOwner.tsx).
- Tests: [`__tests__/livekitSessionIsolation.test.ts`](../../__tests__/livekitSessionIsolation.test.ts), [`__tests__/livekitRoomRpc.test.ts`](../../__tests__/livekitRoomRpc.test.ts), [`__tests__/controlRtcIndependent.test.tsx`](../../__tests__/controlRtcIndependent.test.tsx) y [`__tests__/audienceRtcIndependent.test.tsx`](../../__tests__/audienceRtcIndependent.test.tsx).
- Complementa [0003](0003-active-connection-authority.md), [0005](0005-minimal-dependency-boundaries.md) y [0006](0006-presentation-session-lifecycle.md).
- Documentación operativa y contratos: [Live Audio](../features/live-audio.md), [Despliegue](../operations/deployment.md) y [API HTTP](../api/http.md).
