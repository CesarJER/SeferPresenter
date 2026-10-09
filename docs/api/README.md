# Referencia de contratos

- [HTTP](http.md): operaciones, autenticación, bodies, respuestas, errores y efectos.
- [Realtime](realtime.md): WS/SSE/local, comandos, timeline, admisión, señales privadas y STT.
- [Sincronización](../architecture/synchronization.md): explicación de autoridad y recuperación.

La sintaxis se contrasta con tipos y schemas disponibles, y el comportamiento
con handlers, validadores y consumidores. No hay una especificación OpenAPI o
AsyncAPI ejecutable que cubra el conjunto. Las tablas no amplían garantías
de orden, entrega, retry, concurrencia o recuperación.

Estas referencias describen el checkout reorganizado sobre `57786c1`, incluyendo
las correcciones documentales pendientes. Actualícelas cuando cambien productores,
handlers o consumidores. Las divergencias importantes entre tipos y validación
se indican expresamente; la ausencia de validación exhaustiva no se oculta con
una definición más estricta en el documento.
