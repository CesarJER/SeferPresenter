# Revisión previa a publicación — 2026-10-08

Seguimiento de la [reorganización del 2026-10-07](../2026-10-07/documentation-reorganization.md).
Rama main, HEAD 57786c12dfb81a864a6f3eeaa7bc57e00a1091a2. Se registró el
working tree y un snapshot antes de esta revisión; las correcciones anteriores
se conservaron. Este registro no modifica hallazgos históricos ni certifica una release.

## Documentación pública y retirada de compatibilidad

Por instrucción del usuario se retiraron las diez páginas de compatibilidad de
la raíz de docs y los anchors heredados del README, antes de la primera publicación.
El contenido útil ya reside en arquitectura, desarrollo, API, operación y features.
Las referencias actuales se revisan contra esos destinos; las menciones de rutas
antiguas en auditorías siguen describiendo su fecha.

README ahora presenta propósito, estado, capacidades, rutas, requisitos, prueba
local, límites de autenticación, datos, privacidad, licencias y colaboración.
No se atribuye una licencia inexistente ni se anuncia estabilidad comprobada.
AGENTS.md conserva las reglas de descubrimiento/Context7, cambio seguro y
validación y enlaza las fuentes comunes. La excepción raíz en .gitignore permite
versionarlo; los archivos AGENTS anidados conservan la exclusión previa.

TODO reúne bloqueos de licencia/versión/distribución, privacidad de publicación,
candidato, validación automatizada y real, operación/retención/rollback y entrega.
Distingue tareas corregidas, aceptación pendiente y propuestas Voice. La
preferencia de logs sin recreación/reinicio conserva su criterio de aceptación.

## IMPL-DOC-01: remediación

Hallazgo original: [clear con admisión controlada](../2026-10-07/documentation-reorganization.md#impl-doc-01-clear-de-quiz-con-admisión-controlada).

- Reproducción: los dos casos aislados de clear de un Control principal en
  CONTROLLED recibían 401 en vez de 200, tanto con auth activa como desactivada.
  El segundo caso amplía las condiciones inicialmente observadas, sin reescribir
  la fotografía anterior.
- Corrección en [local-server](../../../server/local-server.mjs):
  QUIZ_CLEAR_ANSWERS comprueba Basic cuando corresponde y reutiliza
  authorizeOperatorCredential con controlOnly. Los aportes conservan el guard de
  admisión Audience. No se exige Bearer y Basic simultáneamente al clear.
- Corrección en [useQuizAnswers](../../../src/hooks/useQuizAnswers.ts):
  envía la credencial activa, espera success HTTP y solo entonces distribuye el
  clear local y limpia agregado. Rechazo HTTP no dispara esa limpieza. Una
  petición completada para otra presentación no borra el agregado nuevo.
- [MenuPopup](../../../src/components/control/MenuPopup.tsx) espera el resultado
  antes de emitir QUIZ_CLEAR_QUESTION_RESULTS; muestra un aviso si no puede
  confirmar. El mensaje no afirma que un fallo de red haya deshecho el servidor.
- Regresiones: borrado de q1 y conservación de q2 en agregado servidor; rechazo de
  Basic solo, Control pendiente, Presenter, Audience y credencial de WS cerrado;
  aportes no admitidos siguen rechazados. Cliente verifica header, rechazo sin
  clear y cambio de presentación con petición pendiente.
- Estado: IMPLEMENTED y VERIFIED en integración loopback/UI mock. Pendiente
  aceptación física de varias pantallas, reconexión y confirmación perdida, en
  [TODO](../../../TODO.md). Clear HTTP y comando posterior no constituyen una
  transacción global; no se prometen recuperación ni rollback de ambos.

## Diagramas

Se sustituyeron los tres bloques por preguntas distintas: autoridad de proyección,
aportes/clear de quiz y guardado de catálogo con ETag. Se separa telemetría del
reducer y no se dibuja un orden común garantizado entre recepción HTTP y SSE.

Context7 resolvió Mermaid y se consultó la documentación de 11.0.0 para render y
accesibilidad. Los tres bloques se parsearon y renderizaron en Edge headless con
esa versión, usando Playwright 1.62.1 del runtime disponible. SVG con título/
descripción y capturas PNG se guardaron temporalmente y se revisaron visualmente.
No se añadió dependencia ni artefacto generado al producto.

Se corrigió un separador de mensaje no aceptado por el parser de secuencias.
La comprobación final pasa; la disposición concreta del renderer de GitHub puede
variar. Renderizar no demuestra comportamiento runtime.

## Validaciones

- Vitest con un worker: 8 archivos, 72/72 tests pasan (autorización HTTP, hook quiz,
  orden de snapshots, seguridad/routing WS, validación quiz, gateway Voice y reducer).
  El intento concurrente anterior sufrió una salida inesperada de worker;
  la ejecución final completa y acotada no mostró ese error.
- tsc de tsconfig.app.json y tsconfig.node.json con noEmit: pasan.
- node --check server/local-server.mjs: pasa.
- ESLint de hook, MenuPopup y los dos archivos de tests modificados: pasa.
- Navegación: 35 Markdown actuales, 258 enlaces internos y 27 rutas citadas;
  sin destinos/anchors ausentes, diferencias de mayúsculas ni fences abiertos.
- SHA-256: 68 artefactos históricos idénticos al snapshot inicial de este
  seguimiento. Las únicas diferencias no Markdown son handler, hook, MenuPopup,
  dos tests y la excepción AGENTS raíz de .gitignore; sin cambios inesperados.
- Context7 Vite 8.0.10 para requisitos/dev-preview; el engine de Vite 8.0.13 se
  contrasta además con el lockfile local. Un resultado upstream de main no se
  trata como prueba de la versión instalada.

No se ejecutaron build/corpus, optimizador, deploy, reinicios, Docker real, STT
real, suite completa ni lint global. Tampoco se eligieron licencia/versión o se
publicaron tags/releases. Las restantes verificaciones del candidato están en
TODO y en la guía de release. Los resultados locales no certifican dispositivos,
SFU, datos privados ni infraestructura efectiva.
