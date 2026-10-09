# Preparar una release estable

Procedimiento para mantenedores. Estable exige evidencia del commit, artefacto y
configuraciones que se publicarán. Esta guía no certifica la estabilidad del
checkout por existir ni convierte pruebas históricas en aceptación vigente.

## 1. Fijar candidato y alcance

Registrar rama, HEAD completo, working tree y contenido exacto del candidato.
Preservar cambios ajenos; una prueba sobre código distinto no valida la release.
Definir versión, plataformas/configuraciones soportadas, funciones opcionales
incluidas y qué queda fuera del alcance estable.

A 2026-10-07 el manifiesto sigue en 0.0.0, no se observaron etiquetas locales ni
releases publicadas en GitHub. No se encontró LICENSE ni CHANGELOG versionados.
Antes de distribuir: acordar versión/política de licencia, preparar notas con
cambios y límites, y verificar derechos/avisos de los activos incluidos. Estos
pendientes no se resuelven atribuyendo una licencia o versión desde documentación.

## 2. Preparar entorno reproducible

Usar un checkout candidato y raíz de datos de prueba separados de la instalación
activa. Registrar versiones de herramientas, configuración sin secretos y flags
de build/runtime. Instalar dependencias del lockfile y preparar ejemplos neutrales.

Revisar scripts y hooks antes de ejecutar. Build/prebuild generan corpus y
deploy optimiza/genera/levanta servicios con override privado: no usar el entorno
real para obtener un check. Los comandos de
[desarrollo](../development/guide.md#tests-y-validaciones) explican tipos/tests/lint.
Ejecutar build completo con datos autorizados en ese entorno y registrar resultado
de hooks y salida; un build sin prehooks es otro check, no equivalencia completa.

## 3. Reunir evidencia automatizada y documental

- [ ] Suite existente sin fallos, tipos de ambos proyectos y lint; registrar
  comandos, versiones, resultado y cualquier incompatibilidad demostrada.
- [ ] Build y arranque del artefacto candidato; reproducir base con opcionales
  desactivados y cada configuración opcional incluida en el alcance.
- [ ] Contratos/autorización: Control principal/pendiente/secundario, Presenter,
  Audience, HTTP sin WS autorizado, snapshots obsoletos y conflictos ETag.
- [ ] Persistencia/recuperación con fixtures: catálogos, mapas, backups, resets,
  límites de sesión y contribuciones quiz.
- [ ] Enlaces/anchors/rutas/ejemplos actuales; propuestas e historia separadas;
  documentación del candidato y notas concordantes.
- [ ] Sin secretos, datos de operador o corpus privado en Git, artefactos o notas;
  avisos de terceros y documentos legales adecuados a la distribución.

## 4. Aceptación operativa del candidato

Registrar caso, configuración/dispositivos, esperado, observado, evidencia y estado.
La matriz debe cubrir:
- [ ] Primera sesión, edición/guardado y conflictos con dos editores.
- [ ] Control → Audience con/sin Presenter y sucesión de Control.
- [ ] Fondos override/candado y modos; música/vídeo, volumen, loop, rate, seek,
  sincronización de cues y límites de autoplay.
- [ ] Navegación scripture, rangos, cambio rápido y slide añadida con corpus de prueba.
- [ ] Audience móvil, PWA/update, accesibilidad de controles y estado offline/online.
- [ ] Admisión pública/controlada, rechazo/bloqueo/desbloqueo, salida y rotación.
- [ ] Quiz completo/parcial, recálculo/clear, umbral, TTL y reconstrucción tras outage.
- [ ] Live Audio incluido: permiso/captura/publicación/recepción, moderación,
  declaración externa y recuperación en dispositivos y redes soportados.
- [ ] Voice incluido: fuente local/remota, principal/secundario, stop/cancelación,
  finales y ACK, STT caído; corpus representativo, errores de reconocimiento,
  P50/P95 y prueba sostenida acordada antes de declarar precisión/rendimiento.
- [ ] Repositorio legal, versiones/hashes, expiración de datos, diagnósticos y logs.
- [ ] Recuperación/rollback de actualización y reinicio; si se soporta IP dinámica,
  verificar DDNS, DNS, IP ICE anunciada y reconexión real.

Use [primera sesión](first-session.md), [Live Audio](live-audio-session.md),
[operación](../operations/deployment.md) y referencias canónicas. No inventar
umbral de aceptación después de observar resultados. Las medidas históricas
de Voice no acreditan corpus representativo ni prueba sostenida del candidato.

## 5. Condiciones de parada y publicación

Parar si fallan permisos/fronteras de datos, persistencia, contrato, build o
recuperación soportada; si la documentación contradice el candidato; o si una
capacidad anunciada estable solo tiene mocks y carece de aceptación operativa.
Resolver, repetir el caso afectado y registrar evidencia. Si una capacidad
se excluye del alcance estable, reflejarlo explícitamente en flags, requisitos
y notas sin presentarla como validada.

Revisar también los hallazgos de implementación de las auditorías. El
[clear de quiz en admisión controlada](../audits/2026-10-08/prepublication-review.md#impl-doc-01-remediación)
tiene remediación con regresiones aisladas; debe incluirse en la aceptación real
del candidato. Comprobar solo el resultado local de Control no acredita que el
agregado servidor se haya borrado.

Mantener pendientes visibles, incluido [borrado temporal de logs](../../TODO.md).
Si la instalación requiere ese plazo para operar, comprobar una política válida
antes de aceptar; la auditoría actual de logs no elimina registros.

Con evidencias suficientes, revisar el diff final y publicar versión/tag/notas/
artefactos mediante el procedimiento autorizado del proyecto. Registrar commit,
hashes, checks, configuración, incidencias conocidas y recuperación. No marcar
una casilla sin evidencia ni usar «estable» para ocultar zonas sin verificar.
