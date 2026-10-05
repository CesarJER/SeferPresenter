# Remediación de la auditoría y fallos reportados

Fecha: 2026-10-05. Base de esta intervención: 4fe6557, rama main.
Referencia: ../2026-09-29/auditoria-tecnica-2026-09-29.md y evidencia independiente de esa carpeta.

## Resultado y alcance

Los hallazgos H01-H04 y M01-M06 tienen correcciones de código y cobertura de regresión. H01-H03 ya tenían correcciones previas; esta intervención refuerza H03 y cierra los pendientes H04/M01-M06. Se corrigieron los caminos identificados de navegación de Sefer, carga/guardado del editor y estado de micrófonos de otros Controls.

Este es un cierre de código con pruebas locales. La validación del servicio publicado, del navegador afectado por el incidente de caché y de micrófonos/salidas reales queda pendiente. No se atribuye retrospectivamente la caída operativa a una causa que no se haya reproducido. No se ha hecho push ni despliegue.

## Matriz de hallazgos

| ID | Corrección y comportamiento resultante | Evidencia actual |
| --- | --- | --- |
| H01 | WS rechaza null, primitivas y objetos inválidos sin terminar el proceso; corrección previa 68bab35 | wsRouting: mensaje inválido y tráfico válido posterior; suite completa pasa |
| H02 | La telemetría no concede canPublish; la autoridad procede del registro/SDK y moderación confirmada; corrección previa 68bab35 | wsRouting y livekitSecurity: status falsificado, refresh/JWT y orden de administración con SDK simulado |
| H03 | Moderación y token Control requieren Basic cuando corresponde, Control autorizado y credencial privada de su conexión, con el mismo controlSessionId | e5207a5; IDs copiados sin credencial o de otra conexión no llegan al SDK |
| H04 | POST command/state y audio/video/display telemetry comparten guard de operador; PENDING no muta aunque conozca Basic | e5207a5; servidor aislado con conexiones reales principal, pendiente, delegado, Presenter y Audience |
| M01 | Reset persistido revoca credenciales, limpia timers/claves y cierra sockets de operador para reentrada normal; IDs duplicados no reemplazan al principal | e5207a5; reset HTTP normal, credencial vieja rechazada, nuevo principal operativo y error de persistencia sin cambio de estado |
| M02 | Se comprueba HTTP OK antes de actualizar catálogo/selección o confirmar éxito; se conserva el borrador ante fallo | 70f0bde; HTTP 500 en editor y cues reales permanecen; importación/selección esperan guardado |
| M03 | GET aporta ETag; POST exige If-Match y rechaza versión antigua con 412 o ausencia con 428 antes de escribir | 70f0bde; dos reemplazos desde una misma revisión conservan el primero |
| M04 | Epoch de arranque y revisión monotónica ordenan GET/SSE/BC; no se restaura una revisión vieja ni un proceso retirado | 8a813eb; GET diferido, BC obsoleto, reinicio y revisión mayor con mismo messageId |
| M05 | Guardar mapas confirmado emite invalidación SSE; Control y editor independiente releen el catálogo actual | 70f0bde; evento tras persistencia y actualización del editor montado sin BroadcastChannel |
| M06 | Alias/visibilidad en envoltura validada con TTL y sesión; purga de legado/expiración/rotación y sincronización de logout | 27ab190; seis tests del hook, incluido TTL montado sin renovación por reconectar |

## Fallos adicionales del usuario

1. **Sefer: referencia correcta con texto desplazado.** a432d0f hace absoluta la proyección ya resuelta y vuelve pasivo el lector Audience. El lector interactivo resuelve una sola vez fuera de un actualizador de React. Pruebas de siguiente/atrás muestran referencia y contenido del mismo versículo y StrictMode no duplica la selección. Se ha preservado el cambio previo del usuario en useScriptureNavigation.
2. **/audio-editor: carga que solo funcionaba tras limpiar caché/incógnito.** 70f0bde usa no-store en GET y JSON del servidor, abre una pestaña nueva desde Control, identifica endpoint/status del fallo y permite reintentar. La inicialización conserva la selección de audio al recibir mapas nuevos. La prueba reproduce un fallo HTTP 401, recuperación y un 500 al guardar; no demuestra cuál fue la causa exacta en el navegador publicado. El service worker actual ya excluye /api/ de su caché.
3. **Dispositivos de audio y mezclas.** Queda en [plan-audio-multidispositivo.md](../2026-10-05/plan-audio-multidispositivo.md), sin implementación. Requisitos confirmados: varias salidas del mismo ordenador con programa y voces LiveKit; varios micrófonos mezclados en una entrada; módulo opcional desactivado por defecto y cargado bajo demanda para evitar coste adicional en Controls móviles.
4. **Micrófonos de otros Controls.** ed38926 publica el estado técnico del Control por WS, incluye Controls en snapshots y combina presencia WS/SFU sin duplicar el propio. Aplica naranja al publicar y azul al publicado; usa la publicación SDK como respaldo cuando todavía no hay status. Regresión montada con Control remoto y ambos colores.

## Validación realizada

| Comprobación | Resultado |
| --- | --- |
| npx vitest run --maxWorkers=2 | 72 archivos, 585 tests pasan en la ejecución final, incluyendo la revisión de cambios previos |
| Regresiones Sefer, HTTP, orden, carga/editor y sesión tras revisión final | 6 archivos, 13 tests pasan |
| livekitSecurity + HTTP de remediación + carga/editor después de ampliar la matriz | 4 archivos, 24 tests pasan, incluido el nuevo caso de IDs copiados con conexión ausente/ajena |
| Hook de identidad tras validar todos los campos de la envoltura | 6 tests pasan |
| Proyección Presenter y carga de entorno retenidas/corregidas | 4 archivos, 9 tests pasan |
| Optimizador modular e índice de texto, medios temporales | 6 tests Python pasan; Pillow real y encoder de vídeo simulado |
| npx tsc -b | Pasa |
| ESLint de fuentes y tests modificados | Sin errores ni advertencias en el alcance final |
| npx vite build | Pasa; salida local dist, sin ejecutar generación de datos del operador |
| git diff --cached --check de cada commit | Pasa |

Una ejecución paralela anterior de varias suites tuvo un worker terminado inesperadamente; no se cuenta como pasada. Las suites afectadas pasaron individualmente y la suite completa posterior pasó con dos workers. Las pruebas que simulan medios no validan drivers, permisos físicos, SFU remoto ni comportamiento real de audio en varios dispositivos.

## Cambios de contrato relevantes

- Las mutaciones operativas HTTP requieren una conexión de operador activa y autorizada. Una caída WS revoca la credencial: Control debe reconectar antes de seguir mutando por HTTP. Un comando fallido lo comunica; no existe un acuse durable general que garantice reproducción de toda intención offline.
- Los POST de presentaciones y mapas requieren If-Match. Un cliente antiguo debe recargar el catálogo; un conflicto conserva el borrador y exige combinar/revisar los cambios antes de reintentar.
- Alias y visibilidad usan localStorage acotado, ligado a la sesión. La documentación ya refleja ese comportamiento. Una reconexión de la misma sesión vigente conserva el estado; caducidad, logout y reset siguen siendo fronteras que purgan identidad/quiz. Las correcciones previas de puntos/outbox y sesión de quiz permanecen.
- Los mensajes de mapas usan el SSE de operadores existente; los catálogos completos no se añaden al canal público Audience.

## Commits de implementación

| Commit | Ámbito |
| --- | --- |
| a432d0f | Referencia y contenido de Sefer; Audience pasivo; selección única |
| e5207a5 | Autoridad privada HTTP/WS/LiveKit, ID de Control y reentrada tras reset |
| 8a813eb | Revisión/epoch y protección de snapshots obsoletos |
| 70f0bde | Persistencia confirmada, ETags, invalidación y recuperación del editor |
| ed38926 | Presencia y micrófonos de Controls remotos |
| 27ab190 | Retención y purga de identidad Audience |
| 0533bd1 | Cambio previo útil de proyección absoluta en Presenter |
| 2153c7d | Configuración de datos y prioridad de variables de entorno |
| 45888f4 | Optimizador modular e índice de texto independiente de legacy |

## Revisión de cambios previos autorizada por el usuario

Se han integrado los cambios útiles previos en commits propios: proyección absoluta en Presenter (0533bd1) y carga temprana de entorno (2153c7d). La carga de entorno corrige la prioridad: variables explícitas > .env.local > .env, antes de resolver SEFER_DATA_DIR.

Se conserva la optimización anterior al despliegue. A petición del usuario se mejora modularmente en 45888f4: imágenes/vídeos/ambos, vista previa, selección de carpeta y backups opcionales. DATA_DIR/asset-optimization.txt guarda un índice JSON de texto con SHA-256 y preset que evita otra compresión aun sin legacy; cambios de contenido se reevalúan. Índice y catálogo se escriben atómicamente; una escritura fallida no elimina el original. La validación usa únicamente fixtures temporales. Véase [ASSET_OPTIMIZATION.md](../../ASSET_OPTIMIZATION.md).

La auditoría y sus evidencias originales se versionan junto a este informe, conservando su contenido. Sus resultados corresponden al snapshot auditado, no a una ejecución nueva contra el código corregido. Este informe registra la remediación posterior; el plan de mezcla de audio permanece separado y sin implementar.
