# Plantilla de política de privacidad para operadores

Estado: **plantilla; no publicar sin completar y validar**  
Versión de plantilla: 2026-07-30

Esta plantilla no es la política predeterminada de SeferPresenter. Cada operador
debe contrastarla con el comportamiento desplegado, su base jurídica, sus
proveedores y la legislación aplicable. Deben eliminarse todas las alternativas,
instrucciones y campos que no correspondan.

## 1. Responsable

- Denominación: `[DENOMINACIÓN LEGAL]`
- Identificador legal, si procede: `[NIF/REGISTRO]`
- Domicilio: `[DOMICILIO]`
- Correo de privacidad: `[CORREO]`
- Sitio web: `[URL]`
- DPD: `[CONTACTO / NO DESIGNADO TRAS CRIBADO DOCUMENTADO]`

No declare que no necesita DPD sin evaluar escala, seguimiento y categorías
especiales.

## 2. Despliegue

- Modalidad: `[SELF-HOSTED / HOSTING CONTRATADO / OTRA]`
- País del servidor: `[PAÍS]`
- Dominio: `[DOMINIO]`
- Funciones habilitadas: `[PRESENTACIÓN / AUDIENCE / QUIZ / LIVE AUDIO / ...]`
- Acceso: `[PÚBLICO / RESTRINGIDO / MIXTO]`
- Grabación externa: `[NO / SÍ, HERRAMIENTA Y PROCEDIMIENTO]`

SeferPresenter no graba por sí mismo. Si OBS, una plataforma o un tercero
captura la salida, describa ese tratamiento como decisión del operador.

## 3. Categorías de datos

Complete solo las utilizadas:

- metadatos de red y conexión;
- identificadores aleatorios de cliente, sesión o participante;
- estado de sincronización y permisos;
- alias temporal;
- lista de alias voluntariamente visibles;
- mensaje privado a Control;
- voz y metadata WebRTC;
- audio/transcripciones y frases de contexto del STT, si habilita Voice Scripture;
- respuestas/progreso de quiz;
- contenido de presentaciones;
- logs, errores y diagnósticos;
- datos incluidos en grabaciones externas;
- solicitudes de derechos e incidentes.

Un UUID o alias no es anónimo si permite distinguir o volver a encontrar a una
persona/sesión. La voz puede identificar aunque no exista nombre visual.

Si utiliza Voice Scripture, identifique el servicio STT, ubicación, destinatarios
y retención real. El flujo normal del gateway es en RAM; su modo diagnóstico
explícito puede loguear transcripciones y aliases privados. No atribuya al
servicio STT una garantía de borrado que no haya verificado.

## 4. Finalidades y bases

| Finalidad real | Datos | Art. 6 elegido | Art. 9 si procede | Prueba/decisión |
| --- | --- | --- | --- | --- |
| `[PRESTAR Y PROTEGER SERVICIO]` | `[DATOS]` | `[6.1.b / 6.1.f / OTRO]` | `[NO / EXCEPCIÓN]` | `[LIA/CONTRATO]` |
| `[PARTICIPACIÓN INTERNA]` | `[DATOS]` | `[BASE]` | `[9.2.d SOLO SI CUMPLE LÍMITES]` | `[GARANTÍAS]` |
| `[ALIAS PÚBLICO]` | `[DATOS]` | `[6.1.a U OTRA]` | `[9.2.a/e, JUSTIFICAR]` | `[EVIDENCIA]` |
| `[VOZ PÚBLICA/GRABACIÓN]` | `[DATOS]` | `[BASE]` | `[EXCEPCIÓN]` | `[AVISO Y PRUEBA]` |
| `[QUIZ]` | `[DATOS]` | `[BASE]` | `[SEGÚN PREGUNTAS]` | `[FINALIDAD]` |

No use interés legítimo como fórmula general: adjunte prueba de finalidad,
necesidad y ponderación. No use el artículo 9.2.d para publicar fuera de una
entidad religiosa sin consentimiento. No considere el dato «manifiestamente
público» solo por asistir a un acto.

## 5. Audiencia pasiva y activa

Explique:

- qué puede hacer una persona sin alias ni micrófono;
- qué acción convierte a Audience en participante activo;
- quién autoriza la palabra o la lista de alias;
- quién puede ver el alias;
- qué alternativa existe sin publicar voz;
- si Control puede silenciar, expulsar o retirar permisos;
- que Control no puede activar el micrófono físico del usuario.

## 6. Grabación y publicación

Seleccione y adapte:

### Opción A — No existe grabación

> El operador no captura ni graba la salida de SeferPresenter. Si esta
> configuración cambia, se mostrará información nueva antes de intervenir.

### Opción B — Solo algunas sesiones

Indique herramienta, quién la inicia, estado visible, canales, destinatarios,
captura exacta, copia local, retención, comentarios, estadísticas, retirada y
si se generan subtítulos.

### Opción C — Todas las sesiones

Justifique necesidad y proporcionalidad. La asistencia no equivale a
consentimiento. Describa alternativas reales y qué ocurre con menores,
conversaciones ambientales, primeros planos y usos posteriores.

No afirme que ser un acto público autoriza cualquier grabación o derivado.

## 7. Proveedores y transferencias

| Proveedor | Servicio | Rol | Datos | País/región | Transferencia | Mecanismo | Contrato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `[PROVEEDOR]` | `[SERVICIO]` | `[ENCARGADO/INDEPENDIENTE/PENDIENTE]` | `[DATOS]` | `[REGIÓN]` | `[SÍ/NO]` | `[ADECUACIÓN/DPF/SCC/OTRO]` | `[REFERENCIA]` |

Incluya DNS, hosting, correo, certificados, soporte, copias, LiveKit externo,
plataformas de vídeo y analítica. No presuma que self-hosted significa ausencia
de terceros.

## 8. Almacenamiento local

Liste `localStorage`, `sessionStorage`, Cache Storage y cualquier cookie o
IndexedDB realmente usado. Indique clave, finalidad, contenido, duración y
borrado.

Solo invoque la excepción de almacenamiento estrictamente necesario de la LSSI
cuando la función sea necesaria para el servicio solicitado. No añada analítica
o personalización a esa excepción.

## 9. Conservación

| Dato | Ubicación | Plazo/criterio | Evento de supresión | Excepción | Evidencia |
| --- | --- | --- | --- | --- | --- |
| `[DATO]` | `[UBICACIÓN]` | `[PLAZO]` | `[EVENTO]` | `[EXCEPCIÓN]` | `[PRUEBA]` |

Evite «indefinido» sin finalidad y criterio. Si existe archivo histórico,
explique qué lo justifica, qué eventos provocan revisión y cómo se atienden
solicitudes.

## 10. Menores

Indique si pueden participar, edad aplicable, base, autorización, esfuerzo de
verificación, alternativa, función de Control y procedimiento de retirada. No
recopile fecha de nacimiento o documentos de toda la audiencia sin necesidad y
evaluación.

Una casilla declarativa no debe presentarse como verificación infalible.

## 11. Derechos e incidentes

Incluya canal, proceso, plazo, verificación proporcional, localización de
grabaciones, destinatarios, autoridad de control y límites frente a copias.

Explique el procedimiento de brechas, documentación, evaluación de riesgo,
notificación en 72 horas cuando proceda y comunicación a afectados si el riesgo
es alto.

## 12. Seguridad

Declare únicamente controles verificados:

- TLS/cifrado en tránsito;
- E2E para mensajes o alias, especificando exactamente qué campos;
- tokens y TTL;
- roles de Control;
- MFA/verificación en dos pasos;
- logs y retención;
- separación de secretos;
- copias y cifrado en reposo;
- pruebas de barrera.

No convierta la existencia de un test en garantía si no se ha revisado también
la implementación y el despliegue.

## 13. ROPA, LIA, EIPD y DPD

Referencias del operador:

- ROPA: `[DOCUMENTO/FECHA]`
- LIA: `[DOCUMENTO/NO APLICA]`
- cribado EIPD: `[DOCUMENTO/FECHA/RESULTADO]`
- EIPD completa: `[DOCUMENTO/NO PROCEDE]`
- cribado DPD: `[DOCUMENTO/RESULTADO]`

## 14. Versionado

- versión de política: `[ID]`
- fecha de vigencia: `[FECHA]`
- commit/release de software: `[SHA/RELEASE]`
- manifiesto de despliegue: `[ID]`
- versión de avisos: `[ID]`
- historial de cambios: `[ENLACE]`

La política no debe publicarse si su manifiesto no corresponde al software y
configuración realmente desplegados.
