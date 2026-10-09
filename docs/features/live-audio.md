# Live Audio

Capacidad opcional de voz en vivo sobre LiveKit. El protocolo técnico está en
[realtime](../api/realtime.md#live-audio-autorización-perfiles-y-snapshots); tokens y
moderación, en [HTTP](../api/http.md#live-audio-tokens-y-moderación).
Para configurarla consulte [operación](../operations/deployment.md), y para usarla,
[sesión con Live Audio](../guides/live-audio-session.md).

## Roles, escucha y publicación

Presenter, Control y Audience conectan pistas de audio al runtime LiveKit separado
de música/vídeo sincronizados. Con la feature desactivada, el uso de presentación
debe seguir disponible. Hay flags distintos de bundle y backend; cargar la UI
no demuestra que LiveKit esté disponible ni que audio llegue al receptor.

Audience puede escuchar pasivamente o participar activamente tras el recorrido
de alias/aviso/admisión. Conceder palabra habilita publicación, pero no abre la
captura automáticamente: cada navegador confirma su micrófono. Presenter y
Control mantienen sus permisos específicos; un Control pendiente no modera.

Cada Control puede activar o desactivar localmente la escucha de audio de programa.
Esta preferencia no cambia fuente Voice, permiso de captura, transmisión ni
media-master. Presencia WS y conexión LiveKit se muestran por separado.

## Moderación y estado observable

| Acción | Resultado |
| --- | --- |
| Pedir palabra | Participante en cola; micrófono cerrado hasta grant y acción propia |
| Conceder | GRANTED y permiso de publicar; no captura automática |
| Silenciar | Cierra/silencia pista; conserva grant |
| Retirar palabra | LISTENER sin publicación |
| Restringir/kick | REVOKED/kicked, sin participación de micrófono/chat; proyección sigue según admisión |
| Rescatar | LISTENER sin publicación ni apertura de micrófono |
| Retirar perfil activo | Solo perfil kicked; limpia flags y permite reingreso limpio |
| Bloquear admisión | Impide acceso de la sesión; es distinto de kick |
| Desbloquear admisión | WAITING, sujeto al siguiente recorrido |

El backend confirma los cambios de permisos con LiveKit antes de confirmar
estado lógico. Un participante ausente necesita reconectar; mostrar un registro
local no acredita pertenencia real a la sala. Mute-all puede actuar parcialmente
antes de un fallo. Los errores no equivalen a un grant confirmado.

## Controls, alias y lista visible

El primer Control registrado es principal; los posteriores quedan pendientes
con código temporal. La autorización, sucesión y snapshot técnico pertenecen al
servidor. Controls autorizados intercambian claves y perfiles por canal privado;
los pendientes no reciben esos contenidos.

Alias, mensajes, nombres internos, respuestas de chat y configuración privada de
micrófono usan PRIVATE_CONTROL_SIGNAL cifrado. El perfil técnico público lleva
identidad y claves/preferencias permitidas; un alias legible se rechaza.

El participante puede compartir alias con activos. Control calcula la lista
legible y la envía cifrada a destinatarios con permiso; el servidor gestiona
preferencias/permisos técnicos. Incógnito y permiso de ver lista son acciones
distintas. La rotación de clave exige volver a comunicar estado; no hay historia
privada recuperada del backend.

## Emisión externa y avisos

Control declara off/live/recording; no se detecta OBS. Cada cambio a live o
recording revoca grants y exige nueva confirmación de publicación para esa
revisión. Los documentos/avisos y manifiestos no nominativos del operador se
explican en [privacidad](../privacy/README.md).

## Fallos y recuperación

El cliente limita a ocho reintentos de conexión con espera creciente.
Expulsión, denegación o fallo administrativo de permisos no se reintentan como
si fueran una caída de red. Nueva admisión tras registro perdido/caducado empieza
escuchando y requiere acción explícita para publicar.

Fallo de captura no debe cerrar escucha. Silenciar cancela también publicación
pendiente; cambiar modo música recrea la pista de micrófono. Nunca restaurar
automáticamente captura a partir de un snapshot técnico.

La validación física de micrófono, altavoces, autoplay, SFU y redes se registra
por instalación/dispositivo. Los tests locales no garantizan conectividad en
todas las redes ni reemplazan [criterios de release](../guides/prepare-release.md).
