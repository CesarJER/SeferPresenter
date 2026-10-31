# Preparar y comprobar una sesión con Live Audio

Para operador autorizado con [instalación configurada](../operations/deployment.md#live-audio-configuración-y-recuperación).
Comportamiento y diferencias de permisos: [Live Audio](../features/live-audio.md).

## Antes de empezar

Verificar build/runtime habilitados, secretos y LiveKit disponibles, documento/
aviso de privacidad aplicable y dos dispositivos con salida audible. Evitar
feedback usando auriculares o separando micrófono y receptor. Asegurar contexto
y permisos que permitan captura; no probar con una grabación real sin el
procedimiento propio del operador.

Comprobar por separado respuesta Node, estado LiveKit y conexión de los clientes.
Un estado available no prueba conectividad ICE ni recepción de sonido.

## Recorrido

1. Abrir Control y comprobar principal/autorizado. Los secundarios deben
   completar autorización antes de moderar.
2. Abrir Audience y completar admisión si la sesión es controlada.
   Comprobar escucha pasiva en el receptor.
3. Para participar activamente, revisar aviso/documento y completar alias.
   Pedir palabra; verificar que la cola aparece en Control y el micrófono
   permanece cerrado.
4. Conceder palabra desde Control. En Audience activar explícitamente el
   micrófono y aceptar permiso del navegador. Hablar una frase de prueba;
   comprobar pista publicada y recepción audible en otro dispositivo.
5. Silenciar: comprobar que cesa la publicación audible. Retirar palabra:
   comprobar que Audience vuelve a LISTENER sin permiso de publicar.
6. En una prueba controlada, restringir y rescatar al participante.
   Rescate debe dejarlo escuchando sin micrófono publicado.
7. Comprobar que activar/desactivar escucha local del Control no cambia
   el permiso de micrófono ni la escucha de otros clientes.
8. Simular una pérdida breve de conexión del dispositivo de prueba.
   Comprobar estados de aplicación/LiveKit y reconexión. Si requiere nueva
   admisión, verificar que empieza sin publicación y vuelve a pedir acción propia.

## Emisión externa y verificación final

Si el operador utiliza emisión/grabación externa, declarar live/recording antes
del cambio correspondiente; comprobar revocación y nueva confirmación de micrófonos.
La declaración no inicia ni detecta OBS. Usar un ensayo autorizado y volver a
off al terminar.

Registrar resultado, dispositivos/configuración y fallos observados sin tokens,
transcripciones ni nicks reales. Para una release, completar también
[pruebas de aceptación](prepare-release.md).

## Fallos y parada

En Audience, un fallo de audio conserva las acciones sociales si admisión, WS y
cifrado siguen disponibles. Utilizar el mensaje privado como respaldo; el botón
de mano reabre un panel oculto. Sin RTC no aparece un micrófono concedido ni se
solicita permiso de captura. La bandeja, admisión, lista y cola de Control también
permanecen disponibles con RTC desactivado o excluido del build.

En Notificaciones, usar el selector «Destinatario» del compositor inferior:
«Control» envía un aviso azul al equipo; elegir Audience prepara un mensaje nuevo
naranja, con el operador y el destinatario visibles. El selector parte de Control,
se vuelve verde oscuro al elegir Audience y vuelve a Control tras aceptar ese envío,
si no se ha editado el borrador ni cambiado el destinatario mientras tanto.
No hace falta que Audience escriba primero. Si el envío seguro no está disponible,
comprobar admisión, conexión, perfil y clave actuales; no conceder micrófono para
habilitar el chat.

Los mensajes entrantes de Audience son grises. «Responder» o «Agradecer» adjunta una
respuesta verde a esa tarjeta; «Responder de nuevo» permite otra respuesta contextual.
Audience puede usar «Responder» desde el mensaje recibido. No hay un panel separado
de historial. Un Control que entra tarde no recupera mensajes anteriores.

Solo aparecen avisos de fallo: distinguir envío a Audience de sincronización del
equipo. Un fallo conserva el borrador; una finalización antigua no borra uno nuevo.
La aceptación local del transporte no confirma recepción ni aplicación remota y no
genera un banner de éxito. Los borradores son efímeros y se pierden al recargar la página.

Ante participant_not_ready, reconectar y comprobar presencia SFU real. Ante
livekit_unavailable o permiso no confirmado, no asumir que se concedió palabra.
Los retries automáticos de red son limitados; denegación, kick o fallo de captura
requieren diagnóstico explícito. Si no llega audio, comprobar permisos, pista,
salida/autoplay y red/ICE por separado.

Detener ante captura inesperada, recepción de voz por un destinatario no previsto,
desacuerdo de permisos o privacidad no configurada. Conservar evidencia neutral
y seguir [diagnóstico y recuperación](../operations/deployment.md).
