# Reorganización documental — 2026-10-07

Registro de esta migración documental, separado de la auditoría previa. No es
una certificación de release ni una actualización de auditorías antiguas.

## Base y preservación

- Rama: `main`.
- HEAD inicial: `57786c12dfb81a864a6f3eeaa7bc57e00a1091a2`.
- Índice de descubrimiento: `C-Users-cesae-Desktop-Tanaj-SeferProyect-SeferPresenter`,
  ready, 3865 nodos y 8370 relaciones; raíz y HEAD coinciden con el checkout.
- Antes de editar se copiaron a un directorio temporal los Markdown existentes
  y se registraron hashes de documentación, código, scripts y configuración.
- Los cambios de la auditoría anterior se incorporan a los destinos canónicos;
  no se restaura ningún archivo a HEAD.
- Los 19 archivos modificados preexistentes eran `.env.example`, `README.md`,
  diez referencias Markdown de la raíz de `docs/`, tres documentos de privacidad,
  `static/legal/privacy.md` y tres archivos de `src/` con correcciones de comentarios.
  Ya existían además `TODO.md`, `coverage.md` y `documentation-audit.md` de esta fecha.
- No se modifica código ejecutable, tipos, configuración, datos del operador,
  infraestructura ni artefactos históricos.

## Matriz de inventario y migración

La columna «fuente» identifica evidencia técnica, no un propietario humano.
No existe ownership documental establecido que permita asignar responsables.

| Documento/origen | Lector y tarea | Lifecycle | Fuente canónica/evidencia | Destino previsto | Cambio y duplicaciones | Trigger de actualización |
| --- | --- | --- | --- | --- | --- | --- |
| `README.md`: propósito, rutas e inicio | Usuario/IA: orientarse | Vigente | Entradas frontend, manifiesto y scripts | README principal y `docs/README.md` | Reducir; enlazar referencias por tarea | Rutas, requisitos, estado de release |
| `README.md`: instalación, datos, seguridad, proxy, logs, PWA y recuperación | Operador: configurar y diagnosticar | Vigente | `server/`, Compose, Dockerfile, scripts, service worker | `operations/deployment.md` | Conservar contenido único y pasos; contratos detallados pasan a API | Flags, rutas de datos, despliegue y recuperación |
| `AI_PROJECT_MAP.md`, `ai-navigation.md`, `COMPONENT_OWNERSHIP.md` | Desarrollador/IA: entender límites y localizar cambios | Vigente | Entradas, hooks, reducers y límites runtime | `architecture/overview.md`, `development/guide.md` | Fusionar mapa, categorías de estado y recorridos; corregir perfil público | Límites, responsabilidades y caminos de modificación |
| `SYMBOL_INDEX.md` | Desarrollador/IA: localizar código | Referencia manual vigente | Código y grafo AST | `development/guide.md` y referencias técnicas correspondientes | Retirar catálogo exhaustivo; conservar recorridos y conocimiento único | Contratos o responsabilidades, no cada símbolo |
| `CHANGE_GUIDE.md`, `CODEBASE_MEMORY.md` | Colaborador: modificar y validar | Vigente | Scripts, tests, generador y herramientas de descubrimiento | `development/guide.md` | Reconciliar mantenimiento, validaciones e impacto documental | Herramientas, convenciones, hooks de build y contratos |
| `SYNC_ARCHITECTURE.md`: autoridad, transportes, timeline y quiz | Desarrollador: entender sincronización | Vigente | `local-server`, `ws-server`, reducer, `useSyncState`, consumidores | `architecture/synchronization.md`, `api/realtime.md` | Separar explicación y contratos; corregir alcance de WS | Autoridad, snapshots, mensajes, recuperación |
| `sync_architecture_diagrams.md` | Desarrollador: seguir flujos | Vigente | Mismos productores y consumidores | `architecture/synchronization.md` | Integrar diagramas útiles junto a explicación | Cambios en los flujos representados |
| README y sincronización: HTTP/WS | Integrador: consultar contrato exacto | Vigente | Tipos, validadores, handlers y clientes | `api/http.md`, `api/realtime.md` | Inventariar también mensajes no incluidos en uniones TS | Payload, permisos, errores, límites y efectos |
| README y sincronización: Live Audio | Usuario/desarrollador: entender capacidad | Vigente | `src/features/liveAudio/`, backend LiveKit y WS | `features/live-audio.md`, `guides/live-audio-session.md` | Separar comportamiento, contrato y procedimiento | Roles, publicación, moderación y recuperación |
| `VOICE_SCRIPTURE.md`: comportamiento y límites | Usuario/desarrollador: entender voz | Vigente | Sesión, parser, worklet, gateway y reducer | `features/voice-scripture.md`, API y operación | Mantener límites y separar instalación de comportamiento | Protocolo, fuentes, parsing, flags, fallos |
| `VOICE_SCRIPTURE.md`: registros 2026-09-09 | Revisor: consultar evidencia del momento | Histórico | Texto recibido y commits de la época | `voice-scripture-historical-notes.md` en este directorio | Extraer literalmente, con fechas originales y procedencia | No actualizar para representar el presente |
| `VOICE_SCRIPTURE.md`: propuestas | Mantenedor: consultar trabajo no implementado | Propuesto | Bloque TODO existente | `TODO.md` | Conservar propuestas identificadas; enlace desde feature | Aceptación, implementación o descarte |
| `ASSET_OPTIMIZATION.md` | Operador: optimizar medios | Vigente con validación histórica | Optimizador, índice y tests sintéticos | `operations/asset-optimization.md` | Conservar funcionalidad y límites; fechar evidencia previa | Presets, persistencia, backup o recuperación |
| `privacy/README.md`, especificación, guía, blueprint y plantilla | Operador/revisor: tratamiento y procedimientos | Vigente / controles remotos propuestos / plantilla | Implementación y documentos legales del operador | Conservar `privacy/` | Enlazar arquitectura, features y contratos; mantener análisis de datos y distinguir publicación soportada de gobernanza pendiente | Datos, retención, permisos, almacenamiento y publicación legal |
| `static/legal/*.md`, `examples/SeferPrivateData/**` | Operador: plantilla y datos neutrales | Plantilla/ejemplo | Archivos y rutas efectivamente servidos | Conservar origen | Revisar enlaces afectados sin incorporar datos privados | Cambio de plantillas o inicialización |
| `docs/audits/**`, `privacy/audits/**`, evidencia y harnesses | Revisor: reconstruir revisiones | Histórico | Snapshot y archivos originales | Conservar íntegros | Las rutas antiguas se mantienen mediante compatibilidad | Añadir comprobación posterior por separado |
| Nuevos ADR | Mantenedor: entender decisiones significativas | Registro retrospectivo | Commits GitHub y comportamiento actual | `adr/` | Cuatro decisiones verificables; distinguir motivación documentada de análisis actual | Nueva decisión o supersesión |
| Nuevas guías | Usuario/mantenedor: primera sesión, audio y release | Procedimiento vigente | UI, configuración y checks existentes | `guides/` | Tres tareas concretas, sin copiar referencias normativas | Cambio del recorrido o criterios de aceptación |

## Contradicciones reconciliadas

1. El perfil público `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE` no admite `alias`:
   `validateActiveParticipantProfile` lo rechaza. El alias usa señal privada E2E.
2. La generación considera el hash del corpus **y** los aliases, y la ausencia
   de metadata/directorio de salida; no depende solo de cambiar la ruta fuente.
3. `/ws` transporta estado, comandos, timeline, admisión y señales técnicas/
   privadas; no está limitado a la timeline de audio.

## Compatibilidad y contenido único

Las diez páginas antiguas de la raíz de `docs/` conservan entradas de
compatibilidad con sus anchors y enlaces a los destinos. Los registros fechados
no se reescriben. La revisión de referencias incluye navegación vigente,
documentos de privacidad, ejemplos, scripts y generadores. Se desconoce el
inventario completo de consumidores externos.

## Hallazgo de implementación sin corrección

### IMPL-DOC-01: clear de quiz con admisión controlada

- Prioridad: P2. Estado: VERIFIED por inspección de guards y caminos de estado;
  efecto completo sobre una sesión real: PARTIAL, no reproducido en dispositivos.
- Condición: modo CONTROLLED y autenticación activa; POST `/api/quiz-answer`
  con `QUIZ_CLEAR_ANSWERS`.
- [Handler HTTP](../../../server/local-server.mjs): primero aplica
  `requireControlledAudience`, que extrae exclusivamente Bearer desde
  `Authorization`; después exige `hasValidBasicAuth` para clear. El
  [parser Basic](../../../server/authUtils.mjs) exige el prefijo Basic en la
  misma cabecera. Los dos requisitos no pueden satisfacerse simultáneamente.
- [MenuPopup](../../../src/components/control/MenuPopup.tsx) llama al clear del
  hook y emite además `QUIZ_CLEAR_QUESTION_RESULTS`.
  [useQuizAnswers](../../../src/hooks/useQuizAnswers.ts) actualiza el agregado
  local y solo captura fallos de fetch, sin comprobar `response.ok`.
- El [reducer](../../../server/projection-state-reducer.mjs) cambia listas de
  preguntas y `scoreRequestId`; el camino de comando en local-server no llama
  al borrado del agregado para este comando. Este camino no compensa el clear
  HTTP rechazado. RESET_STATE con clearSession sí tiene un borrado diferente;
  no es equivalente a borrar una pregunta.
- Impacto: el estado local puede aparentar borrado mientras las contribuciones
  servidor siguen presentes. No se afirma que todos los modos o todos los
  recorridos de quiz fallen.
- Acción: documentado en HTTP y preparación de release; pendiente revisar la
  frontera de autorización y verificar agregado servidor/consumidores. No se
  modificó implementación ni se utilizó una sesión activa para comprobarlo.

## Validación

| Comprobación ejecutada | Resultado y alcance |
| --- | --- |
| Identidad y estado Git | `main`, HEAD inicial conservado; working tree preexistente preservado. |
| Navegación Markdown mediante parser AST | 45 documentos actuales/nuevos, 372 enlaces internos y 29 rutas de código en inline-code; sin destinos ni anchors ausentes, diferencias de mayúsculas en rutas ni fences abiertos. Los enlaces de código cuentan también entre los enlaces internos. |
| Compatibilidad | 117 anchors originales de README y las diez páginas sustituidas conservados. Se desconocen todos los consumidores externos; las rutas publicadas no se eliminan. |
| Sintaxis de contratos contra AST TypeScript | 27 RemoteCommandPayload, 16 miembros BroadcastMessage (15 tipos core y la unión delegada Live Audio), 11 AudioTimelineAction y 26 interfaces LiveAudioBroadcastMessage, sin variantes/campos omitidos en las tablas. |
| Contratos runtime | Revisados productores, validadores, handlers y consumidores de proyección/telemetría, timeline, admisión, quiz, autorización y señales privadas/Live Audio, selección Voice y gateway STT. Las asimetrías de validación y campos runtime se indican en API; no se atribuyen garantías desde el tipo estático. |
| Tests existentes seleccionados | 6 archivos, 43/43 tests pasan. Autorización HTTP, orden de snapshots, seguridad/routing WS, validación quiz y gateway Voice; fixtures temporales, loopback y mocks, sin instalación activa. |
| Preservación de código/configuración | SHA-256 idéntico en los 188 archivos no Markdown registrados al inicio: 139 de src, 22 de server, 13 scripts, 8 static y 6 raíz. El status no añade cambios no documentales. |
| Preservación de historia | 64 artefactos históricos sin cambios; los dos bloques fechados de Voice Scripture están copiados literalmente desde el documento inicial. Los informes preexistentes de esta fecha se conservan. |
| Diagramas | Los tres bloques Mermaid originales se conservan y sus flujos se revisaron contra las fuentes. No se ejecutó parser/renderizador Mermaid: presentación gráfica UNVERIFIED. |
| Diff y revisión de contenido | Revisados destinos nuevos, diferencias documentales, contenido único migrado, navegación, propuestas/historia y diff completo. `git diff --check` pasa. Sin secretos ni datos reales incorporados. |

Comando de tests ejecutado, desde la raíz:

```powershell
node node_modules/vitest/vitest.mjs run __tests__/auditRemediationHttp.test.ts __tests__/hooks/useSyncStateOrdering.test.ts __tests__/wsSecurity.test.ts __tests__/wsRouting.test.ts __tests__/quizMessageValidation.test.ts __tests__/voiceScriptureServer.test.ts
```

Los validadores de navegación, hashes y sintaxis fueron comprobaciones locales
temporales; no se añade otro generador ni una dependencia al producto. La
validación de enlaces cubre el conjunto actual y los dos nuevos registros; las
auditorías anteriores conservan sus referencias históricas sin reinterpretarlas
como enlaces o afirmaciones del presente.

## Resultado, cobertura y límites

Se crearon 19 referencias canónicas en la estructura acordada, más este registro
y la extracción histórica de Voice. Se modificaron respecto al estado inicial
README, diez páginas de compatibilidad, cuatro documentos de privacidad y TODO.
La especificación, los procedimientos y la plantilla de privacidad siguen siendo
documentos diferenciados. No se creó proposals ni directorios vacíos.

La reconciliación conserva la instalación/configuración/diagnóstico/recuperación
del README en operación; mapas y límites en arquitectura; recorridos y
convenciones en desarrollo; contratos HTTP/realtime en API; comportamiento y
cotas Voice/Live Audio en features. Las propuestas Voice pasan a TODO; el borrado
de logs sin recreación/reinicio mantiene sus condiciones de aceptación.

Evaluación: navegación y migración VERIFIED; comportamiento documentado
contrastado estáticamente y con los tests seleccionados. La reorganización no
es una nueva auditoría exhaustiva de todas las ramas del software ni una
certificación de toda afirmación histórica o de un despliegue real. Los hallazgos
previos siguen en el informe de auditoría recibido; IMPL-DOC-01 añade un límite
encontrado al reconciliar contratos.

Context7 no estuvo disponible en esta ejecución. Los requisitos de herramientas
se contrastaron con manifiesto/lockfile/scripts locales; las referencias externas
recibidas no certifican versiones desplegadas ni disponibilidad actual de
servicios. Los ADR enlazan los commits GitHub comprobados y separan sus motivos
documentados del análisis actual; no reconstruyen una aceptación formal.

No se ejecutaron suite completa, tipos, lint o build durante esta reorganización,
ni despliegues, reinicios, migraciones, optimización, corpus, Docker real o STT
real. Las verificaciones de la auditoría anterior mantienen su fecha y alcance;
no se presentan como reejecutadas. SFU/dispositivos, rendimiento/precisión Voice,
recuperación de red/IP y aceptación operativa del candidato quedan PARTIAL o
UNVERIFIED hasta aportar evidencia del entorno correspondiente.

La versión sigue en 0.0.0; licencia de distribución, notas y validaciones de la
primera release son requisitos pendientes. La guía de release impide presentar
como estable un alcance sin pruebas o con fallos materiales, incluido el clear
controlado descrito arriba. No se ha publicado ni etiquetado una release.

Los cambios previos de `.env.example`, tres archivos src, plantilla de política
y `static/legal/privacy.md` no fueron editados por esta reorganización. Las
correcciones previas de documentos consolidados se trasladaron desde su contenido
recibido, sin volver a HEAD. No se realizó commit ni push.
