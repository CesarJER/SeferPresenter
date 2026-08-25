# Guía de cumplimiento para operadores de SeferPresenter

Versión: 2026-07-30  
Esta guía es general y no sustituye el análisis del despliegue ni asesoramiento
jurídico.

## 1. Antes de habilitar el servicio

1. Identifique responsable, contacto y, si procede, DPD.
2. Complete el mapa/ROPA con las funciones realmente activas.
3. Determine bases del artículo 6 y excepciones del artículo 9.
4. Realice LIA para seguridad, conexión y moderación si usa interés legítimo.
5. Haga cribado EIPD y DPD con escala y personas vulnerables reales.
6. Inventaríe proveedores, contratos, subencargados y transferencias.
7. Configure secretos, TLS, cuentas, MFA y roles.
8. Defina retenciones y pruebas de borrado.
9. Adapte política y avisos; no publique la plantilla.
10. Vincule versión legal, configuración y release de software.

## 2. Decisiones funcionales

| Decisión | Preguntas mínimas |
| --- | --- |
| Acceso | ¿Público, privado o mixto? ¿Quién autoriza? |
| Alias | ¿Es obligatorio? ¿Quién lo ve? ¿Puede hacerse público? |
| Mensajes | ¿Quién los recibe? ¿Se copian o leen en voz alta? |
| Voz | ¿Quién puede publicar? ¿Existe alternativa sin voz? |
| Quiz | ¿Conocimiento, opinión, voto o decisión? ¿Hay detalle individual? |
| Grabación | ¿Qué sesiones, fuente, herramienta, estado, canales y copia local? |
| Menores | ¿Pueden intervenir? ¿Qué autorización y alternativa existen? |
| Logs | ¿Qué campos, quién accede, cuánto duran y cómo se borran? |
| Archivo | ¿Qué finalidad, criterio de conservación y procedimiento de retirada? |

## 3. Infraestructura

Documente:

- país y responsable físico del host;
- proveedor de conectividad;
- DNS, dominio y cuenta;
- proxy, CDN, túnel, DDNS o firewall gestionado;
- autoridad de certificados;
- LiveKit/Redis propios o contratados;
- volúmenes y backups;
- driver de logs y rotación;
- monitorización, soporte y acceso remoto;
- proveedor de correo;
- repositorio y CI/CD.

Self-hosted no significa ausencia de terceros: DNS, ISP, certificados, correo o
plataformas pueden recibir datos técnicos.

## 4. Configuración mínima

- Genere claves y secretos únicos; no use valores de ejemplo.
- Manténgalos en `.env` o gestor de secretos, nunca en Git.
- Active HTTPS/WSS.
- Limite Control y cuentas administrativas.
- Active MFA/verificación en dos pasos y guarde códigos de recuperación.
- Defina `LIVEKIT_NODE_IP`; si la IP es dinámica, habilite explícitamente el
  mecanismo HTTPS permitido y documente que consulta la IP del servidor.
- Mantenga Redis sin persistencia si no existe una necesidad documentada.
- Evite exponer puertos internos.
- Mantenga descartados los logs de proxy/SFU/Redis salvo que implante una
  redacción equivalente y la verifique.
- Instale la tarea de retención Docker, observe una ejecución real y documente
  cualquier interrupción breve por recreación.
- Pruebe restauración de copias que realmente necesite.

## 5. Sesiones y Audience

La opción menos intrusiva debe ser:

- acceso pasivo sin alias;
- micrófono apagado;
- alias privado;
- lista pública desactivada;
- mensajes dirigidos solo a Control;
- ausencia de grabación automática.

Explique a Control que un alias puede ser identificativo aunque sea temporal y
que el contexto puede revelar creencias.

## 6. Grabación externa

Si no graba, no muestre avisos ambiguos de «podría grabarse» como si el estado
estuviera activo.

Si graba:

1. anuncie la sesión antes de iniciar la captura;
2. antes de iniciar OBS, seleccione `En directo` o `En directo y grabando` en
   Control; al terminar la captura vuelva a `Sin retransmisión`;
3. use un Audience estrictamente pasivo, sin alias, y no lo convierta en
   participante activo;
4. compruebe que el cambio de estado revocó los permisos de micrófono previos;
5. no omita la nueva confirmación específica de quien quiera publicar voz;
6. ofrezca mensajes privados como alternativa;
7. documente plataforma, público, subtítulos y conservación;
8. antes del micrófono, recuerde evitar autoidentificación y voces de fondo;
9. evite audio ambiental y primeros planos;
10. establezca retirada/edición;
11. genere evidencia no nominativa de versión, estado y aviso.

Configure una raíz `SEFER_PRIVACY_LOCAL_PATH` fuera de Git y los canales y
versiones del despliegue. Compruebe que cada entrada en `recording` crea un único
manifiesto `.local.json` y que la salida lo completa. El manifiesto no sustituye
el anuncio oral ni prueba que OBS esté activo; solo acredita la declaración
técnica efectuada en SeferPresenter.

El estado de la interfaz es una declaración manual del Control autorizado. El
producto no detecta OBS ni garantiza por sí mismo que YouTube, Telegram u otra
plataforma hayan empezado o terminado la captura.

La asistencia no es consentimiento. No afirme que la publicación autoriza
derivados de terceros.

## 7. Menores

- Use lenguaje comprensible.
- No solicite fecha de nacimiento de toda la audiencia sin necesidad.
- Separe audiencia pasiva de intervención pública.
- Para menores de la edad aplicable, exija presencia/autorización parental
  proporcional al riesgo.
- Mantenga separadas la lectura del aviso, la voluntad de publicar voz, el tramo
  de edad y, cuando corresponda, la autorización específica del representante.
- No convierta la barrera declarativa en una afirmación de verificación fuerte;
  compleméntela con supervisión, autorización de Control y micrófono apagado.
- Permita que el adulto intervenga en su nombre.
- Autorice desde Control y detenga si hay dudas.
- Priorice solicitudes de retirada.
- Documente el esfuerzo de verificación en la EIPD.

## 8. Quiz

La implementación agregada oculta resultados con menos de tres aportes y no
entrega a Control respuestas, puntuaciones exactas ni un identificador estable.
Antes de afirmarlo en una política aplicable, verifique el tráfico del despliegue
real. Además:

- no lo use para opinión, voto o decisión sin una evaluación nueva;
- no incluya preguntas sensibles innecesarias;
- no reduzca el umbral sin justificar y evaluar el riesgo;
- purgue navegador y servidor conforme al TTL definido;
- no confunda agregación con anonimato absoluto.

## 9. Proveedores

Para cada proveedor guarde:

- servicio y rol;
- contrato/DPA y fecha;
- región y transferencias;
- mecanismo y medidas complementarias;
- subencargados;
- retención;
- solicitudes y brechas;
- acceso administrativo y MFA;
- responsable de revisión.

Revise especialmente plataformas públicas: condiciones de directo, chat,
comentarios, métricas, subtítulos, reenvío, monetización y retirada.

## 10. Derechos

El procedimiento debe:

1. registrar fecha y tipo de solicitud;
2. verificar de forma proporcional;
3. localizar sin crear un índice innecesario;
4. responder en plazo;
5. comunicar a destinatarios cuando proceda;
6. documentar decisión y medidas;
7. borrar o bloquear el expediente al vencer el plazo.

Para vídeos solicite URL/canal, fecha, minuto y descripción. No implante
reconocimiento de voz solo para atender derechos.

## 11. Incidentes

Prepare un playbook con:

- canal urgente y suplencia;
- contención;
- preservación de evidencia mínima;
- categorías/afectados;
- evaluación de riesgo;
- decisión de notificar AEPD dentro de 72 horas cuando proceda;
- comunicación a afectados si el riesgo es alto;
- documentación de todos los incidentes;
- medidas correctoras y cierre.

No incluya secretos o expedientes reales en el repositorio de producto.

## 12. Retención

Defina por dato, no con una frase global. Como orientación:

- IDs/tokens/estado: sesión y gracia mínima;
- alias/mensajes: sesión;
- progreso local: TTL y logout/rotación;
- quiz agregado: necesidad o anonimización efectiva;
- logs: plazo corto automático;
- contenido: mientras se use;
- grabaciones: finalidad y criterio explícitos;
- derechos/incidentes: obligación y defensa;
- backups: ciclo, restauración y supresión diferida.

Compruebe el borrado con pruebas de runtime. El límite por tamaño de Docker no
equivale a plazo temporal: la configuración general usa recreación programada a
144 horas para mantenerse por debajo de siete días incluso con la comprobación
diaria. Si no instala la tarea, no afirme ese máximo.

## 13. Documentos

Mantenga separados:

- documentación técnica general versionable;
- política/avisos públicos del operador;
- ROPA, LIA, EIPD y expedientes privados;
- secretos;
- evidencias de despliegue;
- incidentes y solicitudes reales.

El Git privado `SEFER_DATA_DIR/legal/` contiene únicamente publicaciones y
documentos jurídicos sin expedientes personales. Los informes de auditoría
pertenecen a su área privada separada.

Active una nueva secuencia solo después de revisar su manifiesto, estado y
hashes. Abra `/proteccion-datos` y compruebe que muestra la versión y el SHA-256
esperados. Un error de carga debe bloquear la intervención, no sustituir
silenciosamente la política por texto antiguo.

Incluya también un `privacy-summary.md` de primera capa que contenga, como
mínimo, responsable, finalidad, legitimación, destinatarios y derechos. Revise
la tabla dentro del aviso previo a intervenir,
inmediatamente antes del enlace a la segunda capa, en anchura móvil y
escritorio. La interfaz no debe mostrar al usuario la ruta interna: el aviso
breve identifica la política mediante versión y hash corto, y la política
completa muestra su SHA-256 completo.

## 14. Git y evidencia

Para documentación local sensible use repositorio separado y privado:

- rama protegida;
- PR y revisión;
- MFA;
- prohibición de force push y borrado;
- tags/releases inmutables cuando se apruebe una versión;
- CODEOWNERS;
- backup de claves y accesos;
- sin datos de asistentes.

El manifiesto de sesión, si se usa, debe ser anónimo y proporcional:

- fecha/hora;
- ID aleatorio no reutilizable;
- versión de software/política/aviso;
- configuración de grabación;
- canales;
- inicio/fin;
- resultado de comprobaciones;
- sin nombres, alias, IP, respuestas o voz.

## 15. Revisión periódica

Revise al menos ante:

- nuevo proveedor o país;
- cambio de dominio/hosting;
- grabación o canal nuevo;
- cambio de conservación;
- nuevo uso del quiz;
- menores o escala distinta;
- cambios en alias, cifrado, logs o permisos;
- incidente;
- nueva versión de política o software.

Una revisión de gobernanza no obliga a revisar manualmente cada contenido si el
criterio de conservación utiliza eventos documentados, pero debe comprobar que
el procedimiento sigue funcionando.
