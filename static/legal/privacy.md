# Información general de privacidad de SeferPresenter

Versión: 2026-07-31-general

Estado: plantilla neutral del producto. No sustituye la política adaptada que
debe aprobar y configurar cada operador.

## Responsable y contacto

El despliegue debe identificar aquí al responsable, su contacto para derechos y
la información exigida por la normativa aplicable. Si estos datos no aparecen,
el operador no debe presentar esta plantilla como su política definitiva.

## Funcionamiento general

- La asistencia pasiva no requiere una cuenta, nombre real, alias ni micrófono.
- La aplicación usa identificadores técnicos aleatorios para conexiones y
  permisos durante la sesión.
- El alias de un participante activo se cifra de extremo a extremo hacia los
  Controles autorizados. Node solo enruta el ciphertext.
- La visibilidad del alias para otros participantes activos es voluntaria y
  requiere además autorización de Control.
- Los mensajes privados se cifran hacia Control y no forman un chat público.
- El micrófono requiere una acción local; Control puede autorizar o revocar la
  publicación, pero no abrir físicamente el micrófono del dispositivo.

## Quiz

Las respuestas detalladas y la puntuación exacta permanecen en el navegador de
Audience. El servidor recibe aportes independientes, conserva hashes acotados
para deduplicación y entrega a Control únicamente contadores agregados. Las
distribuciones no se publican hasta alcanzar tres aportes. El quiz ordinario no
debe reutilizarse como sistema de votación o decisión sin una evaluación nueva.

## Almacenamiento local

El progreso local de Audience y su referencia de sesión se guardan en envolturas
con caducidad. El valor predeterminado es 24 horas y la configuración no permite
superar siete días. Logout, rotación de sesión y expiración purgan los valores de
forma idempotente. Las preferencias operativas de Control pueden tener un ciclo
distinto porque no identifican a asistentes.

La caducidad invalida los valores al leerlos; la eliminación física depende de
que el navegador ejecute la aplicación. No se garantiza borrado puntual mientras
el navegador permanezca cerrado o suspendido.

## Voz y retransmisión externa

Live Audio procesa la voz en tiempo real cuando la función está habilitada. El
estado `off`, `live` o `recording` es una declaración manual de un Control
autorizado; SeferPresenter no detecta ni controla el streaming, la grabación u otra herramienta externa.
Cada transición a directo o grabación revoca permisos de voz anteriores y exige
una nueva confirmación antes de publicar.

Antes de hablar, evite decir nombres completos u otros datos identificativos y
compruebe que no se oyen conversaciones o voces de fondo. Una plataforma
externa puede generar subtítulos automáticos de la intervención.

La confirmación del micrófono separa lectura, voluntad de publicar voz y una
selección local de tramo de edad. Para menores del umbral que establezca el
operador puede exigirse además una declaración de presencia y autorización del
padre, madre o tutor. La selección no debe enviarse ni almacenarse como fecha de
nacimiento o perfil. Es una barrera básica que el operador debe complementar de
forma proporcionada al riesgo.

Cuando se configura una raíz local, la transición a grabación genera un
manifiesto técnico sin asistentes, alias, voz, IP ni identificadores de sesión.
Registra únicamente fechas, canales, versiones, comprobaciones y resultado.

La identidad de los destinatarios, plataformas, finalidad, base jurídica y
conservación de una retransmisión dependen del operador y deben constar en su
política adaptada.

## Logs e infraestructura

El producto no registra deliberadamente IP, `User-Agent`, alias, mensajes,
tokens ni respuestas de quiz en sus logs. La configuración general elimina las
cabeceras de IP antes de los upstream y descarta los logs de proxy, LiveKit y
Redis porque esos terceros pueden emitir direcciones o valores sensibles. Los
logs allowlist de la aplicación usan almacenamiento Docker local, comprimido y
acotado por tamaño. La tarea documentada solo audita metadatos; no borra logs y
no garantiza un máximo temporal de siete días. Una política de borrado por tiempo
requiere una solución específica y verificación en el despliegue.

Si se habilita Voice Scripture, audio y transcripciones se procesan en memoria
por el gateway y el STT configurado. El modo diagnóstico explícito puede escribir
texto y aliases privados en consola; debe quedar apagado en operación normal.
El operador debe revisar por separado los logs y retención del servicio STT.

## Derechos

La política adaptada debe indicar cómo ejercer acceso, rectificación, supresión,
limitación, oposición y los demás derechos aplicables. Para localizar una
intervención externa puede ser necesario que la persona facilite canal, fecha y
minuto, sin crear por ello un registro nominal preventivo de asistentes.
