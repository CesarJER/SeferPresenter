# 0003 — Vincular autoridad HTTP a conexiones autorizadas activas

Estado: decisión implementada; registro retrospectivo.
Redacción: 2026-10-07. Evidencia histórica: 2026-10-05.

## Contexto documentado

[e5207a5](https://github.com/CesarJER/SeferPresenter/commit/e5207a5ff19aef86011ed56d8a1a84873e061069)
declara remediar H04 y reforzar H03: IDs públicos copiados y Controls pendientes
no deben otorgar autoridad HTTP. También vincula renovación Control al registro
LiveKit y limpia la frontera privada al rotar sesión.

## Decisión implementada

Credencial privada por conexión para mutaciones de estado/comandos/telemetría,
tokens Control y moderación. WS debe estar abierto y autorizado; Control
administra comandos, Presenter conserva estado/telemetría. La credencial queda
en memoria de página, no se entrega a Audience ni sustituye los demás guards.

## Consecuencias y trade-offs

El commit documenta fail-closed incluso en LAN con auth global desactivada.
Al caer WS, fallback HTTP pierde autoridad hasta reconectar. IDs de sesión
y Basic Auth solos ya no bastan para esos recorridos.

Análisis actual: mejora vínculo entre presencia autorizada y mutación, a costa
de disponibilidad de escritura durante reconexión. La credencial no protege
frente a todo compromiso del cliente autorizado ni reemplaza TLS/privacidad
de la instalación.

## Evidencia y relaciones

[Guard WS](../../server/ws-server.mjs), [HTTP](../../server/local-server.mjs),
[API LiveKit](../../server/livekit-server.mjs),
[operatorAuth](../../src/utils/operatorAuth.ts) y
[matriz HTTP](../../__tests__/auditRemediationHttp.test.ts).
El commit describe validación aislada y SDK mock; no prueba SFU real.
Complementa [0001](0001-server-projection-authority.md).
Evolución en R4: [0008](0008-realtime-transport-backpressure-and-input-containment.md) refuerza esta decisión revalidando la autoridad por igualdad estricta de referencia tras la lectura asíncrona del body HTTP.
Contrato actual: [HTTP](../api/http.md#autenticación-y-límites-comunes).
