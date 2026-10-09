# 0004 — Ordenar snapshots mediante época y revisión

Estado: decisión implementada; registro retrospectivo.
Redacción: 2026-10-07. Evidencia histórica: 2026-10-05.

## Contexto documentado

[8a813eb](https://github.com/CesarJER/SeferPresenter/commit/8a813eba0eb1f126e1071b9ccfc5155e01f646bf)
declara remediar M04: un GET pendiente, SSE o transporte local podía introducir
un snapshot antiguo después de observar estado nuevo. Reutilizar messageId
también requería distinguir deduplicación de orden de revisiones.

## Decisión implementada

El proceso servidor crea una época y revisiones monotónicas de estado/telemetría,
también en snapshots reducidos Audience. El gate se aplica antes de cambiar
React o su copia persistida: rechaza revisiones antiguas/iguales, épocas retiradas
y rollback no versionado después de observar metadata canónica.
BroadcastChannel no introduce una época servidor de reemplazo.

## Consecuencias y trade-offs

El commit documenta que una revisión nueva sigue siendo válida aunque reutilice
messageId; deduplicación por ID gobierna datos no versionados.

Análisis actual: evita varios rollbacks entre transportes, pero necesita recordar
la época/revisión observada en cliente. La metadata no persiste proyección
servidor, no proporciona orden total de comandos ni entrega exactamente una vez.

## Evidencia y relaciones

[useSyncState](../../src/hooks/useSyncState.ts),
[local-server](../../server/local-server.mjs),
[tests de orden](../../__tests__/hooks/useSyncStateOrdering.test.ts).
Complementa [0001](0001-server-projection-authority.md), sin superseder su autoridad.
Contrato actual: [realtime](../api/realtime.md#estado-permisos-y-dirección).
