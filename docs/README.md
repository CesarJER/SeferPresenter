# Documentación de SeferPresenter

Punto de entrada compartido por usuarios, operadores, colaboradores y agentes de IA.
Empiece por la tarea; las páginas enlazadas permiten profundizar sin cargar todo el repositorio.

| Quiero… | Referencia |
| --- | --- |
| Entender el sistema y sus límites | [Arquitectura](architecture/overview.md) |
| Entender autoridad, sincronización y recuperación | [Sincronización](architecture/synchronization.md) |
| Modificar el código | [Desarrollo](development/guide.md) |
| Consultar interfaces exactas | [Contratos HTTP y realtime](api/README.md) |
| Realizar mi primera sesión | [Primera sesión](guides/first-session.md) |
| Preparar una sesión con voz en vivo | [Sesión con Live Audio](guides/live-audio-session.md) |
| Instalar, configurar o diagnosticar | [Operación](operations/deployment.md) |
| Optimizar medios | [Optimización](operations/asset-optimization.md) |
| Entender Live Audio o Voice Scripture | [Live Audio](features/live-audio.md), [Voice Scripture](features/voice-scripture.md) |
| Revisar privacidad y tratamiento de datos | [Privacidad](privacy/README.md) |
| Conocer decisiones arquitectónicas | [ADR](adr/README.md) |
| Preparar una release estable | [Preparación de release](guides/prepare-release.md) |
| Consultar pendientes y propuestas | [TODO](../TODO.md) |
| Consultar revisiones y evidencia histórica | [Revisión previa a publicación](audits/2026-10-08/prepublication-review.md), [auditoría documental](audits/2026-10-07/documentation-audit.md), [cobertura](audits/2026-10-07/coverage.md), [reorganización](audits/2026-10-07/documentation-reorganization.md), [auditoría técnica anterior](audits/2026-09-29/auditoria-tecnica-2026-09-29.md) |

## Cómo leer y mantener estas fuentes

Arquitectura explica el sistema actual; API define contratos; features describe capacidades;
guías resuelve tareas; operación concentra configuración y recuperación. Los ADR registran
decisiones, y las auditorías conservan evidencia de su fecha. Una prueba histórica no
demuestra el comportamiento de una instalación actual.

Cada cambio de comportamiento debe actualizar su referencia canónica y los resúmenes
dependientes. Las fuentes vigentes están en los destinos anteriores; las antiguas
páginas de compatibilidad se retiraron durante la revisión previa a publicación.
La metodología de desarrollo
y los triggers documentales están en [la guía](development/guide.md#impacto-documental).
