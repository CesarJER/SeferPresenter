# Decisiones arquitectónicas

Un ADR registra una decisión significativa y su contexto. No sustituye
[arquitectura actual](../architecture/overview.md), [contratos](../api/README.md)
ni procedimientos de operación.

## Registros iniciales y de modularización

| ADR | Decisión | Estado del registro |
| --- | --- | --- |
| [0001](0001-server-projection-authority.md) | Autoridad de proyección en backend | Implementada; retrospectivo |
| [0002](0002-operator-data-boundary.md) | Separación de datos del operador | Implementada; retrospectivo |
| [0003](0003-active-connection-authority.md) | Autoridad HTTP ligada a conexión activa | Implementada; retrospectivo (evolución en ADR 0008) |
| [0004](0004-snapshot-ordering.md) | Ordenar snapshots por época y revisión | Implementada; retrospectivo |
| [0005](0005-minimal-dependency-boundaries.md) | Límites mínimos de dependencias y aislamiento de SDKs | Accepted (2026-10-31) |
| [0006](0006-presentation-session-lifecycle.md) | Identidad persistida de sesión y retiro en cascada de fronteras | Accepted (2026-10-31) |
| [0007](0007-session-scoped-rtc-and-media-decoupling.md) | Salas LiveKit acotadas por sesión y desacoplamiento de medios RTC | Accepted (2026-10-31) |
| [0008](0008-realtime-transport-backpressure-and-input-containment.md) | Contrapresión WS, revalidación HTTP y contención de entradas | Accepted (2026-10-31) |

Los ADRs 0001 a 0004 fueron redactados el 2026-10-07 a partir de commits de GitHub y fuentes actuales sobre
`57786c1`. Los ADRs 0005 a 0008 formalizan las decisiones estructurales consolidadas en las fases de
modularización backend P2, R1, R2, R3 y R4 (2026-10-31).

## Crear y mantener un ADR

Numerar consecutivamente con cuatro dígitos y título descriptivo. Un ADR nuevo
empieza Proposed salvo evidencia de decisión ya aceptada. Estados futuros:
Proposed, Accepted, Rejected, Superseded y Deprecated; explicar el estado en prosa.

Plantilla mínima:

```markdown
# NNNN — Título de la decisión

Estado: Proposed.
Fecha: fecha real de redacción/decisión.

## Contexto
Problema, restricciones y evidencia.

## Decisión
Qué se decide y qué alternativas reales se evaluaron, cuando estén documentadas.

## Consecuencias
Beneficios, costes, límites y trade-offs.

## Evidencia y relaciones
Código, tests, commits/PR y decisiones relacionadas.
```

No exigir alternativas ficticias ni ownership desconocido. Si la motivación
histórica no está documentada, decirlo y separar cualquier análisis actual.
Mantener los Accepted como historia: una decisión posterior crea otro registro
que enlaza/supersede al anterior; el anterior recibe estado/enlace de sucesor
sin reescribir su contexto o decisión original.
