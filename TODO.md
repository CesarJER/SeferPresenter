# TODO

Trabajo pendiente para una primera release estable y publicación abierta.
La [guía de release](docs/guides/prepare-release.md) define el procedimiento y
la matriz de aceptación; este archivo registra acciones y evidencia que falta.
Una casilla completada aquí no certifica un despliegue distinto.

## Corregido en la revisión previa a publicación

- [x] 2026-10-12: actualizar dependencias vulnerables compatibles, sustituyendo
  los cambios de las PR #2, #3, #5 y #6. Audit de producción: cero vulnerabilidades;
  suite: 73 archivos y 590 tests; tipos app/node, compilación directa sin corpus
  y lint de la prueba nueva pasan. Añadir regresión DOMPurify en jsdom y CI de
  instalación, audit de producción, tipos, suite y build. Tailwind queda pendiente
  abajo; estas comprobaciones no acreditan aceptación física ni lint global.
- [x] Retirar las diez páginas antiguas de compatibilidad y los anchors del README.
  Conservar arquitectura, contratos, guías e historia en sus destinos canónicos.
- [x] Preparar README para lectores externos y crear AGENTS.md enlazado a las
  fuentes comunes, con codebase-memory y Context7; permitir versionar el archivo raíz.
- [x] Sustituir los diagramas redundantes por proyección, quiz y guardado de catálogo;
  comprobar sintaxis, SVG y legibilidad con Mermaid 11.
- [x] IMPL-DOC-01: separar clear administrativo de admisión Audience; exigir Control
  autorizado activo, confirmar HTTP antes del clear local/comando y conservar
  estado ante rechazo. Regresiones de servidor y cliente pasan.
  Evidencia y límites: [revisión](docs/audits/2026-10-08/prepublication-review.md).

## Bloqueos de publicación y alcance

- [x] Elegir licencia del código: incorporada GNU GPL-3.0-or-later ([LICENSE](LICENSE)),
  [CLA.md](CLA.md), [CONTRIBUTING.md](CONTRIBUTING.md) y vía formal non-GPLv3. Activos
  y librerías de terceros documentados en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [x] Fijar versión inicial `0.1.0-alpha` en manifiesto package.json (conservando `private: true`),
  preparar [RELEASE_NOTES_v0.1.0-alpha.md](RELEASE_NOTES_v0.1.0-alpha.md) y workflow de CLA.
- [x] Fijar configuraciones soportadas: stack base (Node.js LTS, Vite, React 19),
  Live Audio y Voice como opcionales/experimentales, navegadores modernos soportados
  y exclusiones formales documentadas en [RELEASE_NOTES_v0.1.0-alpha.md](RELEASE_NOTES_v0.1.0-alpha.md)
  y [docs/operations/deployment.md](docs/operations/deployment.md).
- [x] Revisar checkout, historial Git y artefactos para publicación abierta:
  verificada ausencia de secretos, `.env*` excluido en `.gitignore`, `.gitattributes` con
  `.github export-ignore`, y aislamiento estricto de datos del operador en `SEFER_DATA_DIR`.
- [x] Definir canal de reporte de vulnerabilidades y soporte, condiciones de
  colaboración y comprobaciones de PR: publicado en [SECURITY.md](SECURITY.md) y
  [CONTRIBUTING.md](CONTRIBUTING.md) mediante GitHub Security Advisories y perfil de GitHub.

## Implementación y mantenimiento pendientes

- [ ] Migrar Tailwind 3 a 4 en una rama independiente antes de integrar la PR #4.
  El audit del 2026-10-12 conserva siete paquetes afectados en su cadena de
  desarrollo (cinco high y dos moderate), por `braces` y `postcss-selector-parser`.
  Revisar PostCSS, CSS, tema hebreo/RTL y compatibilidad de navegadores; validar
  visualmente Control, Presenter, Audience y catálogo. No usar `audit fix --force`
  como sustituto de esta migración ni descartar las alertas como resueltas.
- [ ] Completar aceptación real de IMPL-DOC-01: varios Controls/Audience,
  PUBLIC/CONTROLLED, auth activa/desactivada, desconexión y cambio de presentación.
  Confirmar clear en agregado servidor, SSE y dispositivos, incluida recuperación
  tras confirmación perdida; el clear y el comando posterior no son una transacción.
- [x] I01: acordado que 24 h representa la validez del marcador persistido al arrancar/recargar
  el servidor (`createPresentationSessionStore`) y TTL local de Audience (`VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS`).
  La sesión en memoria RAM no rota en caliente por temporizador automático para evitar cortes en
  presentaciones activas; la rotación en vivo permanece bajo control explícito del operador
  (`rotatePresentationSession`). Decisión documentada en [docs/architecture/synchronization.md](docs/architecture/synchronization.md).
- [x] I02: `scripts/make-pingpong.js` adaptado a selección explícita de archivos por CLI
  (`process.argv.slice(2)`), sin escaneo indiscriminado ni rutas fijas a directorios del operador.

## Validación del candidato

- [ ] Fijar rama/HEAD y working tree del candidato, preservar cambios previos y
  reunirlos en commits revisables. Registrar exactamente qué código/artefacto se prueba.
- [ ] Ejecutar suite completa, tipos de ambos proyectos y lint global desde el
  lockfile; resolver fallos reales y registrar límites. Los 72 tests seleccionados
  de esta revisión no sustituyen la suite ni lint completos.
- [ ] Construir y arrancar el artefacto en entorno separado con datos sintéticos/
  autorizados. Verificar hooks de corpus, flags de build/runtime y cada configuración
  incluida; no usar `deploy` en la instalación activa como check.
- [ ] Completar la [matriz de aceptación](docs/guides/prepare-release.md#4-aceptación-operativa-del-candidato):
  presentación, Audience, permisos, edición concurrente, medios, quiz, reconexión,
  PWA/móvil/accesibilidad y funciones opcionales incluidas.
- [ ] Si se incluye Live Audio, verificar captura/publicación/recepción, moderación,
  SFU y redes soportadas en dispositivos reales; mocks no acreditan audio físico.
- [ ] Si se incluye Voice, usar corpus representativo, positivos/negativos y varios
  hablantes; medir falsos positivos, P50/P95 y uso sostenido con criterios fijados
  previamente. Registrar errores de fuente, STT, ACK y recuperación.
- [ ] Revisar contratos HTTP/WS/privados en el candidato, datos/TTL/privacidad,
  ejemplos públicos, enlaces, rutas y diagramas. Verificar que cambios nuevos
  no dejan propuestas o auditorías presentadas como comportamiento actual.

## Operación, retención y recuperación

- [ ] Implementar, si el driver de logs lo permite de forma soportada, el borrado de logs antiguos por tiempo **sin recrear ni reiniciar contenedores**. Verificar primero el comportamiento de Docker `local`/`json-file` y de Docker Desktop; no borrar ni truncar directamente archivos internos gestionados por Docker. Si esos drivers no permiten cumplir el plazo, evaluar una política de retención compatible con esa condición y documentar sus límites antes de implementarla. Criterio de aceptación: demostrar la eliminación de registros vencidos y que los contenedores conservan su identidad y continuidad de servicio. El script `scripts/rotate-docker-logs.ps1` actual solo audita metadatos; no borra logs ni garantiza retención por tiempo.
- [ ] Verificar configuración de exposición, autenticación, HTTPS, raíz privada,
  publicación legal y diagnóstico sin datos sensibles. Acordar política de logs
  efectiva: límites por tamaño y auditoría no acreditan borrado por edad.
- [ ] Ensayar actualización, backups/restauración y rollback con datos compatibles.
  Comprobar pérdida/recuperación de estado vivo y contribuciones locales. Si se
  soporta IP dinámica, probar DDNS, DNS, IP ICE anunciada y reconexión física.

## Preparar y publicar la release

- [ ] Preparar notas, requisitos, instrucciones de instalación y hashes de artefactos;
  revisión final de licencias, privacidad, diff, pendientes y evidencia.
- [ ] Aceptar el alcance estable solo con los criterios cumplidos. Resolver cada
  bloqueo o excluir explícitamente la capacidad afectada de flags/notas y soporte.
- [ ] Obtener autorización de publicación y ejecutar tag/release/artefactos y cambio
  de visibilidad según el canal acordado; comprobar instalación desde la entrega
  publicada. Esta lista no publica ni modifica GitHub.
- [ ] Registrar commit, versión, configuración, resultados y límites de la release
  en un registro fechado separado de las auditorías anteriores.

## Voice Scripture: propuestas

Propuestas trasladadas; no son comandos de voz implementados ni requisitos
automáticos para publicar el stack base:

- Slide navigation: next, previous, selected position.
- Playback: pause/resume the active medium.
- Display: hide/restore projection.
- Voice control: suspend automation and undo the most recent action.
- Compare local engines on the same clean/noisy/distant-speech and negative corpus
  if recognition accuracy remains insufficient; do not change the navigation API.
- Measure sustained hardware use, memory growth, false projections and P50/P95
  with multiple speakers before declaring performance/accuracy targets achieved.

Estas propuestas no están habilitadas ni interpretadas en la implementación actual.
