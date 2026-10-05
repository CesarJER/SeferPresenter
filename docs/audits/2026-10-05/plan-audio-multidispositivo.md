# Plan de audio: varias entradas y salidas locales

Fecha: 2026-10-05. Estado: propuesta para discutir; sin implementación de mezcla múltiple.

## Requisitos confirmados

- Varias salidas simultáneas del mismo ordenador, todas con programa (música/vídeos) y voces recibidas por LiveKit.
- Varios micrófonos del mismo ordenador mezclados en una única entrada de LiveKit, con nivel y silencio por micrófono.
- Módulo opcional activable, desactivado por defecto y cargado bajo demanda. Los Controls móviles que no lo activen conservan el camino habitual.
- Conservar la autorización de publicación, el consentimiento, la moderación y la preferencia local de escuchar programa.

## Diagnóstico del selector actual

El selector guarda un ID para programa y otro para LiveKit. No representa varias salidas. useAudioDevices enumera cambios de hardware, pero no valida la selección guardada ni presenta errores de permisos/dispositivo al operador. Las llamadas a setSinkId en main-control, SlideVisualizer y LiveAudioTrackOutput solo escriben errores en consola.

En LiveAudioTrackOutput el efecto que aplica setSinkId se declara antes del que adjunta la pista y no depende de cambios de pista. Que attach del SDK sobrescriba la selección es una hipótesis que debe reproducirse antes de atribuirle el incidente. mediaVolume crea un grafo Web Audio para algunos vídeos en iOS; ese camino usa la salida del AudioContext. En escritorio, el camino normal conserva la salida del elemento multimedia.

El SDK ofrece [switchActiveDevice](https://github.com/livekit/client-sdk-js/blob/main/_autodocs/api-reference/Room.md) para una salida activa. [setSinkId de HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId) requiere compatibilidad, contexto seguro y permiso de salida. Se debe comprobar el resultado real, no solo guardar una opción. [AudioContext.setSinkId](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId) también selecciona una salida y tiene compatibilidad limitada.

## Diseño propuesto

Dos mezclas locales independientes:

1. **Entrada publicada:** cada micrófono seleccionado se captura por su deviceId, pasa por su propio GainNode y entra en un destino Web Audio común. Una única pista de ese destino se publica como micrófono en la sesión LiveKit existente. El programa y las voces remotas quedan fuera de esta mezcla.
2. **Salida escuchada:** programa y pistas remotas entran en una mezcla común. Un elemento audio por dispositivo reproduce el mismo MediaStream, con su propio sinkId, nivel y silencio. La entrada local no se reproduce por defecto para evitar retorno/acople.

[createMediaStreamDestination](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination) proporciona una pista de salida del grafo. [publishTrack](https://github.com/livekit/client-sdk-js/blob/main/_autodocs/api-reference/LocalParticipant.md) acepta una MediaStreamTrack de audio personalizada. Hay que gestionar explícitamente el ciclo de vida de las capturas y del grafo: que el SDK silencie o deje de publicar la pista mezclada no basta por sí solo para detener cada micrófono físico.

La mezcla de salida reutiliza los niveles actuales de programa/voz y el autoduck. La preferencia programAudioEnabled silencia solo la parte del programa. Al activar la ruta múltiple se desactiva la reproducción directa equivalente para evitar que una fuente suene dos veces. El modo de una salida conserva el camino actual hasta completar la validación.

## Módulo opcional y carga en móviles

El mezclador se separa del Control habitual en un módulo con importación dinámica. La pantalla de dispositivos puede ofrecer una acción explícita para activarlo cuando el navegador sea compatible. Antes de esa acción no se cargan su interfaz ni su motor, no se crea el AudioContext del mezclador y no se abren capturas, medidores, destinos ni salidas adicionales. Esta garantía se refiere al módulo nuevo; el audio habitual del producto mantiene su ciclo de vida actual.

La activación es local y no modifica a otros Controls ni otorga permisos de micrófono. En móviles permanece desactivado por defecto. Desactivarlo detiene todos sus micrófonos físicos, desconecta nodos, cancela escuchas y libera el contexto propio del módulo; restaura la reproducción habitual sin abrir de nuevo micrófonos automáticamente.

La validación debe comprobar que el bundle inicial de Control no contiene el motor/interfaz del mezclador, que cargar Control en móvil no solicita recursos adicionales del módulo, y que activar/desactivar repetidamente no deja pistas o nodos activos.

## Entrega por fases

| Fase | Cambio | Criterio de aceptación |
| --- | --- | --- |
| 1 | Corregir y diagnosticar la selección de una salida: aplicar tras attach/reemplazo de pista, mostrar dispositivo realmente aplicado y errores, detectar desconexión y ofrecer salida predeterminada | Música, vídeo y voz llegan a la salida elegida; permisos denegados o salida desaparecida se muestran claramente |
| 2 | Añadir mezcla de varios micrófonos como opción local; nivel, medidor y silencio por fuente; una publicación final | Dos micrófonos se oyen por separado y juntos; cerrar micro, revocar palabra o salir detiene todas las capturas; desconectar uno conserva los demás |
| 3 | Añadir varias salidas seleccionables con la misma mezcla de programa y voces | Dos o tres salidas suenan simultáneamente sin duplicación; cada una puede silenciarse; fallo de una no corta las demás |
| 4 | Comprobar recuperación con los dispositivos reales del ordenador | USB/HDMI/Bluetooth: desconexión, reconexión, cambio de salida predeterminada, suspensión y reapertura; sin reactivar micrófonos sin consentimiento |

La reconexión LiveKit debe recuperar la escucha y reconstruir conexiones de pistas sin duplicar nodos. La publicación de micrófonos seguirá el consentimiento actual. Los devices seleccionados pero ausentes aparecen como desconectados; los demás continúan. El retorno a la salida predeterminada debe ser visible y controlable.

## Límites que hay que comprobar

- Que Windows y el navegador permitan abrir simultáneamente los micrófonos y salidas elegidos; permisos y soporte varían.
- Latencia, deriva y acople de dispositivos distintos. No se promete sincronía perfecta entre USB, HDMI y Bluetooth. La aceptación requiere escuchar/medir el resultado real.
- Duplicación si se abren varias pestañas locales reproduciendo la misma sesión. La opción de mezcla debe tener un propietario local claro y mostrar dónde está activa.
- Captura con cancelación de eco y filtros frente a modo música: conservar los modos existentes y comprobar su efecto con varias entradas.

No se añaden salas, canales de red, base de datos ni un servicio de audio nuevo. Los repetidores o el router externo pueden seguir como solución operativa durante la validación. Las fases anteriores se revisarán con el usuario antes de implementar esta funcionalidad.
