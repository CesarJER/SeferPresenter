# 0001 — Autoridad de proyección en el backend

Estado: decisión implementada; registro retrospectivo.
Redacción: 2026-10-07. Evidencia histórica: 2026-06-21.

## Contexto documentado

El [commit de centralización](https://github.com/CesarJER/SeferPresenter/commit/23f8c8bb6056e008d8b787c6b4ee070177ec7af6)
añade un reducer servidor y cambia la documentación que describía Presenter
como fuente viva. La documentación de ese commit identifica al backend como
fuente práctica, capaz de navegar Control → Audience sin Presenter.

No se conserva en esta colección una discusión completa de alternativas ni
una aprobación formal del ADR. La motivación adicional no se reconstruye.

## Decisión implementada

Los comandos de proyección soportados se validan/reducen en backend y se
distribuye SYNC_STATE. Presenter renderiza y aporta telemetría del medio real.
La timeline de audio tiene autoridad propia, separada de currentState.

## Consecuencias: análisis actual

Permite navegación independiente del display Presenter y concentra las
transiciones canónicas. El backend pasa a ser dependencia de esas transiciones;
su estado vivo sigue siendo volátil. Renderizado, autoplay, media y espejos
locales no desaparecen ni quedan validados por el reducer.

## Evidencia y relaciones

Fuentes actuales: [reducer](../../server/projection-state-reducer.mjs),
[local-server](../../server/local-server.mjs), [useSyncState](../../src/hooks/useSyncState.ts)
y [pruebas del reducer](../../__tests__/utils/projectionStateReducer.test.ts).
Estado presente: [sincronización](../architecture/synchronization.md).
[0003](0003-active-connection-authority.md) delimita autoridad; [0004](0004-snapshot-ordering.md)
complementa el orden de observaciones, sin superseder esta decisión.
