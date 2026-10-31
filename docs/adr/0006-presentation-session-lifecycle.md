# 0006 — Identidad persistida de sesión de presentación y ciclo de vida de fronteras

Estado: Accepted. Decisión arquitectónica implementada y verificada a través de los hitos P2, R3-SSE, R3-Timers y R4.
Fecha: 2026-10-31.

## Contexto

En versiones tempranas de SeferPresenter, la identidad de la sesión de presentación (`presentationSessionId`) carecía de un protocolo estricto de persistencia y retiro coordinado. Las investigaciones y auditorías de seguridad en P2E, R3-SSE, R3-Timers y R4 evidenciaron fallas de aislamiento al rotar sesión:

1. **Retención de streams SSE de audiencia (R3-SSE):** Conexiones de audiencia autorizadas durante una sesión anterior bajo modo `CONTROLLED` continuaban abiertas tras `RESET_STATE`, recibiendo eventos de proyección de la nueva sesión sin requerir readmisión por el nuevo Control.
2. **Resurrección de proyección por timelines de audio activas (R4 / WP-02):** Un comando `RESET_STATE` con `clearSession: true` reseteaba la proyección en memoria, pero la timeline de audio (`timelineManager`) continuaba reproduciéndose (`status: 'playing'`). El evaluador periódico de cues (100 ms) resolvía la presentación anterior desde el catálogo y la volvía a proyectar en la nueva sesión sin intervención del operador.
3. **Retención de temporizadores de control y gracia (R3-Timers):** Códigos temporales de Control pendiente y períodos de gracia de participantes retenían temporizadores en Node.js que sobrevivían al cierre de conexiones o rotación de sesión.

Era necesario establecer una fuente canónica de identidad y un orden verificado de invalidación local síncrona y limpieza remota al cruzar fronteras de presentación.

## Decisión

1. **Identidad canónica única:**
   El backend establece a `presentationSessionStore` como la única fuente canónica de verdad para `presentationSessionId`. Ningún subsistema (HTTP, WebSocket, LiveKit, SSE o timeline) puede generar ni mantener identificadores de sesión divergentes.
2. **Persistencia y ventana de reinicio (24 horas):**
   La identidad de sesión se persiste en disco (`SEFER_DATA_DIR/presentation-session.json`). Al arrancar o reiniciar el proceso Node.js, si el marcador tiene menos de 24 horas (`PRESENTATION_SESSION_TTL_MS`), se reanuda la misma sesión; si ha expirado, se genera automáticamente una nueva frontera.
3. **Rotación en caliente exclusivamente bajo control explícito:**
   Durante la ejecución continua del servidor, la sesión en memoria RAM **no rota automáticamente por reloj** para evitar cortes de servicio o desconexiones imprevistas en reuniones en vivo. La rotación en caliente solo se produce mediante acción explícita del operador (`rotatePresentationSession`).
4. **Secuencia verificada de rotación e invalidación:**
   La rotación en `ws-server.mjs`, `local-server.mjs` y `livekit-server.mjs` ejecuta estrictamente el siguiente orden:
   - **Persistencia síncrona previa:** `presentationSessionStore.rotate()` persiste el nuevo marcador a disco mediante `writeJsonSafely`. Si la escritura en disco falla, se lanza `SESSION_PERSISTENCE_FAILED`, abortando la rotación y preservando intactos la sesión, la timeline y el estado previos.
   - **Callback de coordinación local (`onPresentationSessionRotated`):**
     1. *Reset de timeline y cursores:* `timelineManager.reset()` detiene la reproducción síncronamente y se reinician `lastActiveCueIndex = -1` y `lastSyncMapId = null`.
     2. *Invalidación síncrona de estado RTC:* `liveKitApi.onPresentationSessionRotated` limpia síncronamente los mapas en memoria (`participants`, `issuedTokens`, `roomState`).
     3. *Limpieza remota SFU desacoplada y asíncrona:* En segundo plano (`void`), se espera la resolución de cualquier creación en vuelo y se emite la llamada RPC `deleteRoom` hacia el SFU con timeout acotado (2 s, máximo 2 intentos). Si la llamada remota falla, se registra una advertencia sin revertir la rotación local ni bloquear la nueva sesión.
     4. *Emisión de timeline inactiva:* `broadcastTimelineState()` difunde el estado `idle`.
   - **Limpieza de estado WebSocket y streams:**
     1. Se cancelan temporizadores de sesión (`clearSessionTimers`).
     2. Se limpian registros en memoria de controles, participantes, admisiones y tickets SSE.
     3. `snapshotProviders.invalidateAudienceStreams?.()` cierra síncronamente los streams SSE activos de audiencia y de quiz no administrativo.
     4. Se restablecen el modo de acceso por defecto y la emisión externa (`off`).
     5. Se emite `PRESENTATION_SESSION_ROTATED` a todos los clientes.
     6. Se resetea la sesión criptográfica privada de control y se cierran las conexiones WebSocket de operadores con código 1012.
5. **Diferenciación semántica de soft reset:**
   `RESET_STATE` sin `clearSession: true` se mantiene como un reset suave de la proyección, preservando la sesión y la reproducción de la timeline existente.

## Alternativas consideradas

- **Rotación automática en memoria por expiración de TTL:** Rechazada porque desconectaría abruptamente a la audiencia y controles durante presentaciones largas que excedan el límite temporal.
- **Fusionar timelineManager dentro de presentation-session:** Rechazada para preservar la separación de responsabilidades: la sesión gestiona identidad y persistencia; la timeline gestiona la reproducción multimedia.
- **Reinicio completo del proceso Node.js en cada rotación:** Rechazada por introducir tiempos de inactividad inaceptables y degradar la experiencia de usuario.

## Consecuencias y límites

- **Garantías verificadas:**
  - Aislamiento comprobado de la proyección y el audio entre sesiones en las rutas probadas (SSE, timeline, WebSockets y tokens en memoria).
  - Eliminación del riesgo de reactivación espontánea de presentaciones retiradas por la timeline de audio anterior.
  - La falla en la persistencia local del marcador preserva el estado previo sin corromper el identificador en memoria.
- **Límites explícitos:**
  - La persistencia local y la secuencia de callbacks no constituyen una transacción distribuida: una caída del proceso o del sistema operativo durante la rotación podría requerir recuperación mediante el procedimiento de arranque estándar.
  - Los clientes de audiencia bajo modo `CONTROLLED` pierden acceso a los streams de eventos y deben completar una nueva admisión tras la rotación.
  - Las peticiones HTTP que coincidan con la ventana de rotación son rechazadas con HTTP 403 y deben ser reintentadas por el cliente.

## Seguridad e implicaciones operativas

- Mitiga vulnerabilidades de retención de autorización y desincronización de estado entre sesiones sucesivas.
- Garantiza que la persistencia en disco sea condición previa obligatoria antes de modificar la frontera en memoria.

## Evidencia y relaciones

- Implementación en [`server/presentation-session.mjs`](../../server/presentation-session.mjs), [`server/ws-server.mjs`](../../server/ws-server.mjs) y [`server/local-server.mjs`](../../server/local-server.mjs).
- Tests de invalidación y persistencia: [`__tests__/presentationSession.test.ts`](../../__tests__/presentationSession.test.ts) y [`__tests__/auditRemediationHttp.test.ts`](../../__tests__/auditRemediationHttp.test.ts).
- Complementa [0001](0001-server-projection-authority.md), [0003](0003-active-connection-authority.md) y [0004](0004-snapshot-ordering.md).
- Relacionado con [0007](0007-session-scoped-rtc-and-media-decoupling.md) y [0008](0008-realtime-transport-backpressure-and-input-containment.md).
- Contratos: [Sincronización](../architecture/synchronization.md) y [API HTTP](../api/http.md).
