# Fase 5 — Análisis jurídico general

Fecha de revisión: 2026-07-30  
Ámbito: SeferPresenter como producto self-hosted y los tratamientos que puede
habilitar. Los datos, proveedores y decisiones de un operador concreto se
mantienen exclusivamente en su anexo `.local`.  
Estado: análisis jurídico-técnico de cumplimiento; no sustituye el criterio de
un profesional colegiado ni la validación contractual de cada despliegue.

## 1. Resultado ejecutivo

SeferPresenter no es, por el mero hecho de distribuirse como software, el
responsable ni el encargado de todos los despliegues. La entidad que decide
para qué se usa una instancia, quién participa, qué se publica y durante cuánto
tiempo es normalmente el **responsable del tratamiento**. El desarrollador solo
será encargado si trata datos por cuenta del operador y siguiendo sus
instrucciones; el código self-hosted, sin acceso remoto del desarrollador, no
crea por sí solo esa relación.

La asistencia a una reunión, aunque sea pública y se haya anunciado una
retransmisión, **no equivale por sí sola a consentimiento**. Deben distinguirse
la asistencia pasiva, la aparición accesoria y la intervención voluntaria. La
activación deliberada del micrófono, después de una información clara y una
acción separada, puede estructurarse como consentimiento explícito para la voz y
su contenido, pero requiere poder demostrarlo, permitir retirarlo y ofrecer una
forma real de participar sin publicación.

El contexto de una reunión religiosa puede hacer que alias, voz, mensajes o
respuestas revelen creencias. Por eso no basta con una base del artículo 6:
cuando exista categoría especial también debe concurrir una excepción del
artículo 9. El artículo 9.2.d puede cubrir actividades internas de una entidad
religiosa sin ánimo de lucro respecto de miembros, antiguos miembros o personas
con contacto regular, con garantías, pero no permite comunicar esos datos fuera
de la entidad sin consentimiento. El artículo 9.2.e exige que sea el propio
interesado quien haya hecho manifiestamente público el dato; no debe presumirse
por acudir a un acto.

El producto tiene dos incumplimientos de diseño que condicionan cualquier
documentación definitiva:

1. el alias atraviesa una ruta legible por el servidor pese al diseño declarado
   de cifrado de extremo a extremo;
2. el quiz conserva detalle individual en RAM y lo distribuye a Control, aunque
   la finalidad declarada sea agregada.

La publicación externa, grabación, proveedores, transferencias, derechos sobre
voz o imagen y conservación no pertenecen automáticamente a SeferPresenter,
pero sí al mapa del operador que decide integrarlo con herramientas externas.

## 2. Roles de protección de datos

| Actor | Rol probable | Condición o límite |
| --- | --- | --- |
| Operador de una instancia | Responsable | Decide finalidades, participantes, avisos, controles, publicación, conservación y proveedores. |
| Desarrollador/distribuidor | Fuera del tratamiento o proveedor de software | No es encargado si no recibe ni puede acceder a datos del despliegue. |
| Soporte con acceso a datos | Encargado potencial | Requiere instrucciones, acceso limitado y contrato del artículo 28. |
| Alojamiento, correo o analítica contratada | Encargado o responsable independiente según servicio | El rol se determina por las operaciones y el contrato, no por la etiqueta comercial. |
| Plataforma que publica contenido y además trata cuentas, seguridad o métricas para fines propios | Responsable independiente o relación mixta | Deben revisarse las condiciones reales; no debe declararse corresponsabilidad o encargo sin analizarlas. |
| Controles autorizados | Personas autorizadas bajo la autoridad del responsable | No son destinatarios externos si actúan dentro de instrucciones y permisos documentados. |

Si dos entidades deciden conjuntamente los fines y medios esenciales, deben
evaluar la corresponsabilidad del artículo 26. La mera interoperabilidad o la
existencia de términos estándar no basta para concluirla.

## 3. Principios del artículo 5

| Principio | Aplicación exigida |
| --- | --- |
| Licitud, lealtad y transparencia | Informar antes de recoger alias, mensaje, quiz o voz; separar claramente emisión en directo y grabación/publicación. |
| Limitación de la finalidad | No reutilizar voz, alias, mensajes o quiz para perfiles, votaciones u otros fines sin evaluación e información nuevas. |
| Minimización | No pedir nombre real ni fecha de nacimiento si no son necesarios; eliminar el detalle individual del quiz; no registrar IP salvo necesidad acreditada. |
| Exactitud | Permitir corregir un alias o atribución y evitar vincular un seudónimo a una identidad no verificada. |
| Limitación del plazo | TTL para sesión, snapshots, navegador y logs; plazo o criterio revisable para publicaciones externas. |
| Integridad y confidencialidad | E2E real donde se declara, roles de Control, secretos fuera de Git, cifrado en tránsito, acceso mínimo y pruebas de borrado. |
| Responsabilidad proactiva | Mapa/ROPA, evaluación de riesgos, evidencias de avisos, decisiones de base jurídica, contratos, pruebas y revisiones versionadas. |

## 4. Artículos 6, 7 y 9: bases y límites

### 4.1 Interés legítimo

Puede ser adecuado para conexión, seguridad, sincronización, moderación,
prevención de abuso y operación interna mínima, siempre que el operador haga un
análisis de interés legítimo que documente:

1. el interés concreto y legítimo;
2. la necesidad del tratamiento frente a alternativas menos intrusivas;
3. la ponderación de expectativas, impacto, menores y salvaguardas;
4. el derecho de oposición cuando proceda.

No habilita por sí solo categorías especiales. Tampoco justifica
automáticamente una publicación mundial o conservación indefinida.

### 4.2 Consentimiento y consentimiento explícito

Cuando sea la base elegida, debe ser libre, específico, informado, inequívoco,
demostrable, distinguible de otros textos y tan fácil de retirar como de dar.
Para datos que revelen religión se necesita **consentimiento explícito** si se
utiliza el artículo 9.2.a.

Una confirmación informada en interfaz es un mecanismo para expresar y probar
la voluntad, no una base jurídica autónoma. Debe indicar, como mínimo:

- si existe directo y si quedará grabado;
- destinatarios y plataformas;
- acceso público y criterio de conservación;
- que el micrófono es opcional;
- alternativa sin voz pública;
- cómo retirar el consentimiento y sus límites prácticos tras la difusión.

El consentimiento no debe agrupar en una sola aceptación micrófono, alias
público, mensajes, quiz y usos posteriores.

### 4.3 Actividad legítima de una entidad religiosa

El artículo 9.2.d puede ser apropiado para tratamientos internos, con garantías,
cuando se refieran exclusivamente a miembros, antiguos miembros o personas con
contacto regular por los fines de la entidad. Tiene dos límites decisivos:

- no cubre sin más a cualquier visitante ocasional o audiencia mundial;
- no permite comunicar el dato fuera de la entidad sin consentimiento.

Por ello, puede combinarse con una base del artículo 6 para participación
interna, pero no basta para publicar voz o intervenciones en plataformas
abiertas.

### 4.4 Dato manifiestamente hecho público

El artículo 9.2.e se interpreta de forma restrictiva. Una intervención
deliberadamente pública puede aportar elementos para aplicarlo al contenido que
la persona decidió revelar, pero no debe usarse como única garantía para:

- asistencia silenciosa;
- sonido ambiental o conversación privada;
- menores;
- primeros planos no necesarios;
- reutilización posterior distinta;
- inferencias que la persona no hizo manifiestamente públicas.

### 4.5 LOPDGDD y creencias religiosas

La LOPDGDD impide descansar únicamente en el consentimiento cuando el fin
principal del tratamiento sea identificar las creencias religiosas de la
persona. La finalidad ordinaria de transmitir una intervención no parece ser
crear un registro de creencias, pero el operador debe impedir que alias, quiz,
voz o mensajes se conviertan en perfiles de afiliación.

## 5. Análisis separado de situaciones

| Situación | Estructura jurídica posible | Riesgo y límites |
| --- | --- | --- |
| Asistencia pasiva | Interés legítimo para conexión/seguridad y, en ámbito interno, posible art. 9.2.d | No implica consentimiento para ser grabado o publicado. Deben evitarse captación ambiental y listados públicos. |
| Aparición meramente accesoria | Ponderación caso por caso; las excepciones del derecho a la imagen son estrechas | No debe diseñarse la captura contando con que toda aparición en un acto sea accesoria. |
| Intervención voluntaria sin grabación externa | Interés legítimo o relación interna más art. 9.2.d; consentimiento si la expectativa lo exige | Mantener alternativa por mensaje y controles de moderación. |
| Activación deliberada del micrófono con grabación pública | Consentimiento explícito art. 6.1.a + 9.2.a, expresado en acción separada | Debe demostrarse, retirarse y no ser condición para asistir. Aviso estático no basta si no refleja el estado real. |
| Culto público anunciado como retransmitido | Libertad religiosa y de información apoyan la finalidad, pero no sustituyen los arts. 6/9 ni los derechos de personalidad | El anuncio reduce sorpresa; la asistencia sigue sin ser consentimiento. |
| Primer plano o identificación destacada | Consentimiento expreso y finalidad específica salvo excepción legal aplicable | Riesgo alto; evitar por defecto y aplicar control editorial. |
| Testimonio personal | Consentimiento explícito separado, revisión del contenido y posibilidad de edición/retirada | Puede revelar múltiples categorías especiales y datos de terceros. |
| Menor | Protección reforzada, información adaptada y autorización/consentimiento parental cuando proceda | La mera casilla declarativa puede no acreditar suficientemente autorización en una publicación de alto impacto. |
| Conversación ambiental o privada | No captar; si se capta accidentalmente, suprimir o editar antes de publicar | No queda cubierta por el aviso general ni por la intervención de otra persona. |
| Uso posterior distinto | Nueva prueba de compatibilidad o nueva base/consentimiento e información previa | No asumir que el archivo público autoriza derivados, promoción, entrenamiento o perfilado. |

## 6. Derechos a la intimidad, imagen y voz

La Ley Orgánica 1/1982 exige consentimiento expreso cuando esta sea la
habilitación y permite revocarlo. Sus excepciones sobre imagen en actos públicos
se refieren principalmente a personas de notoriedad pública o a imágenes
meramente accesorias en información gráfica sobre un suceso público; no crean
una licencia general para captar de forma destacada a asistentes ordinarios.

La voz es dato personal cuando permite identificar o singularizar. El hecho de
que un contenido sea accesible públicamente no autoriza cualquier reutilización.
El operador debe advertir del riesgo real de copias por terceros sin afirmar que
las autoriza ni que puede garantizar su eliminación completa.

La libertad religiosa comprende reunirse, enseñar y divulgar el credo, pero su
ejercicio está limitado por los derechos y libertades fundamentales de las
demás personas. La finalidad religiosa legítima debe, por tanto, conciliarse
con minimización, información, elección y retirada.

## 7. Artículos 11, 12 a 14 y 15 a 22: identificación, transparencia y derechos

- El artículo 12 exige procedimientos transparentes, accesibles y con respuesta
  en plazo; los artículos 13 y 14 determinan la información según los datos se
  obtengan del interesado o de otra fuente.
- No es obligatorio recopilar identidad adicional únicamente para poder
  responder derechos. Si el responsable no puede identificar al solicitante
  debe explicarlo; el interesado puede aportar información adicional.
- Para localizar una grabación puede pedirse la URL, fecha, minuto aproximado y
  descripción o muestra estrictamente necesaria, evitando una base general de
  nombres y voces.
- La información debe facilitarse por capas, en lenguaje claro y en el momento
  de recogida. La capa breve no sustituye la política completa.
- Deben cubrirse acceso, rectificación, supresión, limitación, oposición y,
  cuando proceda, portabilidad y retirada del consentimiento.
- Una solicitud relativa a contenido público debe evaluarse individualmente. Si
  procede borrar, el responsable debe actuar también frente a los destinatarios
  y plataformas dentro de sus posibilidades razonables.
- No se encontró una decisión automatizada con efecto jurídico. Un futuro uso
  del quiz para votaciones o decisiones exige una evaluación nueva.

## 8. Privacidad desde el diseño, seguridad e incidentes

El artículo 25 exige que la configuración por defecto sea la menos intrusiva:
alias privado, micrófono apagado, ausencia de publicación automática, mínimo
detalle de quiz y retenciones acotadas.

El artículo 32 requiere medidas proporcionadas al riesgo. Para este producto son
prioritarias:

- eliminar el alias claro y verificar el E2E con pruebas negativas;
- agregar el quiz en cliente o servidor sin exponer respuestas individuales;
- proteger Control y las cuentas del operador con MFA y mínimo privilegio;
- excluir secretos y anexos `.local` del repositorio y del build;
- controlar logs, copias, dispositivos compartidos y borrado;
- registrar y ensayar el procedimiento de incidentes.

Toda brecha debe documentarse. Si existe riesgo para las personas, se notifica a
la autoridad de control sin dilación indebida y, cuando sea posible, dentro de
72 horas; si el riesgo es alto, puede ser necesaria además comunicación a los
afectados.

## 9. ROPA, EIPD y DPD

### Registro de Actividades de Tratamiento — artículo 30

Debe mantenerse un ROPA cuando el tratamiento no sea ocasional, pueda implicar
riesgo o incluya categorías especiales. La excepción para organizaciones de
menos de 250 personas no resulta aplicable automáticamente. El mapa de Fase 4
es la base, pero cada operador debe completar responsable, bases, destinatarios,
transferencias, plazos y medidas reales.

### Evaluación de Impacto

Debe realizarse antes de un tratamiento probablemente de alto riesgo. La lista
de la AEPD indica que, en la mayoría de casos, la concurrencia de dos o más
criterios orienta a realizarla. Este tipo de despliegue puede acumular:

- identificadores y metadatos de servicios web;
- datos que revelan religión;
- menores de 14 años;
- publicación o conservación amplia;
- combinación innovadora de participación en tiempo real y difusión.

El producto general necesita una plantilla de EIPD. Cada operador debe decidirla
con sus hechos y escala; la publicación de voz religiosa de menores o la
conservación pública prolongada inclinan claramente hacia completarla.

### Delegado de Protección de Datos

Una entidad religiosa no está obligada a designar DPD solo por su naturaleza.
Será obligatorio si concurre alguno de los supuestos del artículo 37 RGPD o del
artículo 34 LOPDGDD, como observación habitual y sistemática a gran escala o
tratamiento a gran escala de categorías especiales. La decisión exige documentar
escala, frecuencia, alcance geográfico y número de afectados. Puede designarse
voluntariamente o contratarse asesoramiento externo sin denominarlo DPD.

## 10. Encargados y transferencias

Antes de publicar documentación definitiva, cada operador debe:

1. inventariar hosting, DNS, correo, certificados, soporte, plataformas y
   subencargados;
2. determinar el rol efectivo de cada proveedor;
3. formalizar artículo 28 cuando el proveedor sea encargado;
4. revisar ubicación, acceso internacional y mecanismos de artículos 44 a 49;
5. documentar decisión de adecuación, DPF, cláusulas tipo y medidas
   complementarias cuando proceda;
6. reflejar que una plataforma pública puede tratar datos para finalidades
   propias y recibir solicitudes directamente.

La existencia de cifrado en tránsito no elimina una transferencia ni sustituye
el análisis contractual.

### Publicaciones en YouTube y Telegram

Cuando un operador elija YouTube o Telegram, debe tratarlos como integraciones
externas y no como funciones propias de SeferPresenter:

- **YouTube:** revisar la titularidad de la cuenta, contratos aceptados en
  Studio, reglas de emisión en directo, privacidad de Google, transferencias,
  chat/comentarios, métricas, retención y retirada;
- **Telegram:** un canal público es almacenamiento cloud accesible al público,
  no un chat secreto E2E; revisar la entidad contratante, sociedades del grupo,
  transferencias, administradores, reenvío y borrado;
- en ambos casos, el operador conserva responsabilidad sobre la decisión de
  subir el contenido aunque la plataforma sea responsable de tratamientos para
  sus propias finalidades;
- la ausencia de monetización no elimina la necesidad de base, información,
  conservación limitada y atención de derechos.

Fuentes de proveedor que cada operador debe revisar en la fecha de contratación:
[contratos de YouTube](https://support.google.com/youtube/answer/9962634?hl=es),
[marcos de transferencias de Google](https://policies.google.com/privacy/frameworks?hl=es)
y [privacidad de Telegram para el EEE](https://telegram.org/privacy/eu).

## 11. LSSI y almacenamiento local

El almacenamiento o acceso en el dispositivo exige información y, salvo
excepción, consentimiento. No se necesita consentimiento para almacenamiento
estrictamente necesario para prestar un servicio expresamente solicitado.
SeferPresenter puede amparar así el estado técnico de sesión, seguridad o la
función solicitada, pero debe:

- informar de claves, finalidad y duración;
- evitar introducir analítica o finalidades adicionales bajo esa excepción;
- purgar el progreso y la sesión de dispositivos compartidos;
- revisar por separado el progreso persistente del quiz y cualquier preferencia
  no imprescindible.

No se encontró uso de cookies ni IndexedDB en el código auditado; no debe
afirmarse lo contrario. La ausencia de banner solo es defendible mientras todo
el almacenamiento siga siendo estrictamente necesario o exista otra solución
válida.

## 12. Conservación

Cada categoría necesita un plazo o criterio propio:

- conexión, alias, mensajes, tokens y moderación: sesión y gracia mínima;
- quiz local: sesión o plazo explícito, con purga verificable;
- quiz agregado: mientras sea útil y verdaderamente anónimo;
- logs: plazo corto definido por el operador y borrado automático;
- presentaciones y atribuciones: mientras se mantenga el contenido;
- expedientes de derechos e incidentes: plazo legal/defensa documentado;
- grabaciones públicas: criterio editorial, revisión periódica y procedimiento
  de retirada; «indefinido» sin revisión no satisface por sí solo el principio
  de limitación.

## 13. Conclusiones obligatorias para documentación y código

1. No describir SeferPresenter como sistema de grabación: solo emite voz y
   estado; la captura externa debe documentarse como tratamiento del operador.
2. No equiparar acto público, asistencia, aviso o casilla con una autorización
   universal.
3. Implementar señal/procedimiento fiable que muestre cuándo existe
   retransmisión y grabación.
4. Separar consentimiento de micrófono, alias público y usos posteriores.
5. Mantener participación por mensaje como alternativa a publicar la voz.
6. Corregir alias E2E, quiz agregado, TTL y logs antes de certificar garantías.
7. Crear ROPA, EIPD cuando corresponda, análisis de interés legítimo,
   procedimiento de derechos e incidentes y revisión de proveedores.
8. Mantener todos los hechos del operador en `.local`; `public/legal/` solo
   contendrá los textos legales finales destinados a publicación.

## 14. Fuentes primarias y oficiales consultadas

- [RGPD, texto oficial en EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [LOPDGDD, texto consolidado del BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673)
- [Lista AEPD de tratamientos que requieren EIPD](https://www.aepd.es/documento/listas-dpia-es-35-4.pdf)
- [Directrices 05/2020 del CEPD sobre consentimiento](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en)
- [Ley Orgánica 1/1982 sobre honor, intimidad e imagen](https://www.boe.es/eli/es/lo/1982/05/05/1/con)
- [Ley Orgánica 7/1980 de Libertad Religiosa](https://www.boe.es/buscar/act.php?id=BOE-A-1980-15955)
- [LSSI, texto consolidado del BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758)
- [Guía AEPD sobre cookies](https://www.aepd.es/guias/guia-cookies.pdf)
- [AEPD: eliminación de fotos y vídeos de internet](https://www.aepd.es/areas-de-actuacion/internet-y-redes-sociales/eliminar-fotos-y-videos-de-internet)

## 15. Verificación y límites

- El análisis parte del mapa de 20 tratamientos de la Fase 4.
- Se contrastó con normativa y criterios oficiales vigentes a la fecha.
- No se inspeccionaron contratos, cuentas ni configuración real de proveedores
  de un operador.
- No se asigna una base definitiva a un despliegue sin sus hechos y decisiones.
- No se modificó código de producto ni se ejecutó build.
