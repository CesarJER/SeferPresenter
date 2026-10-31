# 0008 — Contrapresión en tiempo real, revalidación de autoridad HTTP y contención de entradas

Estado: Accepted. Decisión arquitectónica implementada y verificada en los hitos P2B, R2, Selijot, R4/WP-01 y R4/WP-03.
Fecha: 2026-10-31.

## Contexto

Durante las auditorías de modularización del backend se identificaron tres fallas de robustez y límites de transporte en tiempo real:

1. **Ausencia de contrapresión de salida unificada (R2):** Clientes WebSocket lentos o con conexiones saturadas acumulaban buffers de memoria no acotados en Node.js, amenazando la estabilidad de todo el servidor. Los latidos (`SERVER_TIME_PING/PONG`) y mensajes de error escapaban a las políticas de presupuesto.
2. **Autoridad HTTP obsoleta por carreras asíncronas (R4 / WP-01):** En las rutas de operador (`/api/command`, `/api/state`, `/api/audio-telemetry`, `/api/video-telemetry`, `/api/display-telemetry`), la autorización se comprobaba al recibir los encabezados HTTP antes de `await readBody(req)`. Si durante la lectura del cuerpo la conexión original se cerraba, o la sesión de presentación rotaba, o un nuevo cliente se conectaba reutilizando el mismo identificador (`controlSessionId`), la petición continuaba ejecutándose con la autoridad histórica y mutaba la nueva sesión.
3. **Terminación del proceso Node.js por telemetría malformada (R4 / WP-03):** Mensajes pequeños de telemetría de audio o vídeo provenientes de clientes autorizados alcanzaban el consumidor de eventos sin validación exhaustiva de su forma interna. Un acceso a propiedades inexistentes (p. ej. `msg.audioState.lastUpdatedBy`) lanzaba un `TypeError` síncrono no contenido en el loop de eventos, derribando el servidor.

Asimismo, era necesario formalizar la decisión arquitectónica sobre el diseño de singletons de proceso y rechazar descomposiciones innecesarias.

## Decisión

1. **Política unificada de contrapresión de salida en WebSocket (R2):**
   - Todas las emisiones y respuestas WebSocket (`sendJson`, `broadcastWs`, `sendError`, `SERVER_TIME_PONG`) convergen estrictamente en la función `sendWsFrame`.
   - Se establece un límite máximo de buffer de salida de 512 KiB por socket, calculando explícitamente el tamaño de la carga útil y el framing del protocolo WebSocket.
   - Si un cliente lento excede ese presupuesto, se cierra la conexión de forma proactiva con código de error apropiado, protegiendo la memoria del proceso servidor.
2. **Revalidación de autoridad HTTP tras lectura asíncrona (WP-01):**
   - En las cinco rutas de operador, el guard captura al inicio:
     1. El identificador canónico de la sesión: `sessionId = presentationSessionStore.getSessionId()`.
     2. La referencia al objeto de metadatos de la conexión: `req.operatorMeta = authorizeOperatorCredential(req, { controlOnly })`.
   - Si la comprobación inicial falla, se rechaza inmediatamente con HTTP 403 `OPERATOR_FORBIDDEN` sin consumir el cuerpo.
   - Se lee el cuerpo una sola vez en `req.operatorBody`.
   - Justo antes de delegar a los handlers y antes de cualquier mutación de estado, se verifica:
     ```javascript
     if (presentationSessionStore.getSessionId() !== sessionId ||
         authorizeOperatorCredential(req, { controlOnly }) !== req.operatorMeta) {
       sendJson(res, 403, { code: 'OPERATOR_FORBIDDEN', error: 'The original operator connection is no longer authorized' });
       return;
     }
     ```
   - **Garantía por igualdad de referencia:** Como `authorizeOperatorCredential` busca entre las conexiones activas, si el socket original se cerró o fue reemplazado, la referencia al objeto de metadatos cambia (`!==`), impidiendo que un Control sustituto autorice peticiones huérfanas de una conexión anterior.
   - Los handlers consumen `req.operatorBody` sincrónicamente sin pausas asíncronas adicionales, eliminando carreras de tiempo de comprobación y tiempo de uso (TOCTOU).
3. **Validación semántica simétrica y contención de excepciones (WP-03):**
   - HTTP y WebSocket comparten la función `validateTelemetry`, reutilizando los predicados puros exportados por `ws-message-validation.mjs`: `isAudioState`, `isVideoState` (admitiendo `videoState: null`) y `hasSafeNesting`.
   - Se impone un límite de profundidad JSON ($\le 128$) que neutraliza ataques de desbordamiento de pila por objetos profundamente anidados.
   - Los paquetes de telemetría inválidos se descartan en WebSocket (retornando `false`) y se rechazan con HTTP 400 antes de mutar cualquier estado o emitir eventos.
   - En el despachador de mensajes WebSocket, las llamadas al callback de consumidor (`onFallbackMessage`) se protegen mediante un bloque `try/catch` por mensaje, emitiendo un envelope `ERROR` con código `INVALID_MESSAGE` hacia el emisor infractor sin interrumpir el proceso Node.js ni perjudicar a clientes sanos.
4. **Singletons deliberados e inyección de dependencias:**
   - Se mantiene deliberadamente la arquitectura de singletons de proceso para los administradores de estado central (`wsServer`, `timelineManager`, `presentationSessionStore`).
   - Se rechaza formalmente fragmentar `local-server.mjs` o `ws-server.mjs` en micro-routers abstractos o buses de eventos genéricos por simple recuento de líneas, reconociendo que para una aplicación self-hosted de sala única, la inyección directa en el bootstrap proporciona máxima trazabilidad, simplicidad y rendimiento sin dependencias circulares.

## Alternativas consideradas

- **Colas persistentes y reintentos ilimitados para clientes lentos:** Rechazada porque degrada el rendimiento de tiempo real y consume memoria de forma descontrolada.
- **Captura global mediante `process.on('uncaughtException')`:** Rechazada por constituir una mala práctica que enmascara fallos estructurales graves y puede dejar al proceso en estado corrupto. La contención debe ser local y por mensaje.
- **Microservicios o buses de eventos (Pub/Sub):** Rechazada por sobrediseño injustificado (YAGNI), al introducir latencia, complejidad operativa y puntos de fallo innecesarios.

## Consecuencias y límites

- **Garantías acotadas respaldadas por pruebas:**
  - Protección comprobada de la memoria y estabilidad del servidor frente a clientes lentos y paquetes de telemetría pequeños malformados en las rutas probadas.
  - Mitigación efectiva de carreras de TOCTOU en peticiones HTTP con cuerpos lentos o diferidos mediante revalidación de referencia antes del primer efecto.
  - Aislamiento de fallos síncronos en el despachador de WebSocket a nivel de mensaje individual, sin degradar conexiones sanas simultáneas.
- **Límites explícitos y ausencia de rollback transaccional automático:**
  - **Sin rollback automático:** La captura de excepciones (`try/catch`) en el despachador de WebSocket evita la terminación del proceso y responde con `ERROR` / `INVALID_MESSAGE`, pero no revierte automáticamente mutaciones parciales previas en memoria si un handler llegase a alterar estado antes de lanzar un error. La robustez frente a mutaciones incompletas depende estrictamente de que la validación semántica de datos (`validateTelemetry`, comprobación de roles y esquemas de comando) se ejecute de forma previa e íntegra antes de iniciar cualquier mutación o difusión.
  - Peticiones HTTP legítimas pero lentas que coincidan con una rotación de sesión o desconexión del operador serán rechazadas con 403; el cliente debe conservar su borrador o intención y reintentar bajo su nueva conexión autorizada.

## Seguridad e implicaciones operativas

- Refuerza la frontera de autorización contra secuestros de sesión y peticiones desfasadas.
- Asegura que ningún fallo de validación en tiempo real provoque la caída del servicio para el resto de los participantes en sala.

## Evidencia y relaciones

- Implementación en [`server/local-server.mjs`](../../server/local-server.mjs), [`server/ws-server.mjs`](../../server/ws-server.mjs) y [`server/ws-message-validation.mjs`](../../server/ws-message-validation.mjs).
- Tests de contrapresión e invalidación: [`__tests__/auditRemediationHttp.test.ts`](../../__tests__/auditRemediationHttp.test.ts), [`__tests__/wsSecurity.test.ts`](../../__tests__/wsSecurity.test.ts) y [`__tests__/backendTimerLifecycle.test.ts`](../../__tests__/backendTimerLifecycle.test.ts).
- Complementa [0001](0001-server-projection-authority.md), [0003](0003-active-connection-authority.md), [0004](0004-snapshot-ordering.md), [0006](0006-presentation-session-lifecycle.md) y [0007](0007-session-scoped-rtc-and-media-decoupling.md).
- Contratos: [API HTTP](../api/http.md) y [API Realtime](../api/realtime.md).
