# Fase 8 — Correcciones técnicas prioritarias

Fecha: 2026-07-31  
Alcance: protocolo Live Audio, alias, quiz, Audience pasivo y declaración de
retransmisión/grabación.  
Estado: implementación y pruebas automatizadas completadas; quedan pruebas de
runtime multidispositivo antes del cierre definitivo de los riesgos P0.

## 1. Resultado ejecutivo

Esta fase implementa las correcciones PR-01 a PR-05 del plan de remediación sin
introducir datos de ningún operador en el producto general.

- El alias deja de formar parte de perfiles y snapshots legibles por Node. Se
  entrega a Controles autorizados exclusivamente mediante señal privada E2E.
- El servidor deja de conservar o entregar respuestas individuales, nombres,
  puntuaciones exactas o un identificador estable de quiz. Solo mantiene
  contadores y hashes acotados de identificadores independientes por ámbito;
  no publica distribuciones con menos de tres aportes.
- Un Audience pasivo no puede recibir la lista visible de participantes ni aun
  enviando manualmente el mensaje técnico de permiso.
- Un Control autorizado puede declarar `off`, `live` o `recording`; el estado y
  su revisión se muestran a los clientes. La declaración es manual y no detecta
  ni controla OBS.
- Cada transición a `live` o `recording` invalida permisos anteriores, ordena
  cerrar pistas locales y exige una confirmación nueva antes de publicar voz.

## 2. Correcciones implementadas

| ID | Implementación | Evidencia principal | Estado de cierre |
| --- | --- | --- | --- |
| PR-01 | Perfil activo claro limitado a ID técnico, visibilidad y clave pública; alias por `PRIVATE_CONTROL_SIGNAL`; snapshot sin alias. | `src/types/liveAudio.ts`, `LiveAudioAudienceContainer.tsx`, `LiveAudioControlContainer.tsx`, `server/ws-server.mjs` | Código/tests completos; inspección de tráfico pendiente |
| PR-02 | Mensajes agregables por opción, cita y rango; IDs aleatorios independientes por ámbito; hashes para deduplicación; umbral de publicación de tres aportes. | `src/hooks/useQuizAnswers.ts`, `server/quiz-message-validation.mjs`, `server/local-server.mjs`, `MenuPopup.tsx` | Código/tests completos; prueba multidispositivo pendiente |
| PR-03 | El servidor exige Audience activo y clave pública antes de habilitar la lista; el perfil claro rechaza `alias`. | `server/ws-server.mjs`, `__tests__/activeParticipants.test.ts` | Verificado por prueba negativa |
| PR-04 | Estado externo autorizado, revisado y distribuido como `off/live/recording`; indicador Audience y selector Control. | `src/types/liveAudio.ts`, contenedores/paneles Live Audio, `server/ws-server.mjs` | Implementado; depende del procedimiento manual del operador |
| PR-05 | La transición revoca oradores/permisos y fuerza confirmación por revisión antes de una nueva publicación de micrófono. | `server/livekit-server.mjs`, `server/ws-server.mjs`, contenedores Audience/Control | Código/tests completos; verificación con LiveKit real pendiente |

## 3. Diseño de privacidad resultante

### Alias

El mensaje público `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE` no admite `alias`.
Node solo conoce el identificador técnico efímero, la preferencia de compartir y
la clave pública de destino. El texto del alias y la lista visible permanecen
dentro de `PRIVATE_CONTROL_SIGNAL`.

### Quiz

Las respuestas detalladas siguen en el navegador que las produce. Para cada
pregunta, resultado de cita y cálculo final se genera un identificador distinto.
Node procesa el aporte para incrementar el contador correspondiente, guarda solo
su hash dentro del ámbito concreto para evitar duplicados y no puede reconstruir
un recorrido individual entre preguntas. Control recibe exclusivamente el
snapshot agregado cuando el grupo alcanza tres aportes.

Este diseño es adecuado para gamificación/autoevaluación. No autoriza a tratar
el quiz actual como sistema de votación: una votación requiere función, amenaza,
secreto, autenticidad y base jurídica propias.

### Retransmisión externa

SeferPresenter no se integra con OBS, YouTube o Telegram. El Control declara el
estado antes de iniciar la herramienta externa y lo devuelve a `off` al
terminar. Por ello la interfaz expresa el estado declarado, no una prueba
forense de que exista grabación.

## 4. Garantías y límites

Garantías cubiertas por código y tests:

- el perfil activo claro con alias es rechazado;
- el snapshot operacional no contiene alias;
- un Audience pasivo no obtiene permiso para la lista;
- los contratos antiguos de quiz individual son rechazados;
- la transición a grabación revoca un permiso de voz existente;
- los mensajes nuevos pasan validación de protocolo.

Límites pendientes de comprobación:

- captura controlada de tráfico WS/SSE para demostrar ausencia de alias y
  respuestas individuales en ejecución real;
- sesión real con varios Audience para contrastar agregados y deduplicación;
- prueba con LiveKit y navegador reales de cierre y nueva confirmación de pista;
- verificación operacional de que Control cambia el estado antes/después de OBS.

## 5. Riesgo residual y siguiente fase

PR-01, PR-02, PR-04 y PR-05 permanecen en **cierre técnico condicionado** hasta
completar las pruebas de runtime anteriores. PR-03 queda cerrado mediante prueba
negativa automatizada.

La Fase 9 debe abordar, por orden:

1. logging por lista permitida, sin IP por defecto y eliminación automática en
   un máximo de siete días;
2. TTL y purga idempotente de estado local;
3. autorización segura de Control por defecto;
4. origen único/versionado de avisos y política legal;
5. prueba controlada multidispositivo de las medidas de esta fase.

## 6. Verificación

- `npm.cmd run test -- --maxWorkers=1`: **PASS**, 36 ficheros y 256 tests.
- pruebas dirigidas de alias, permisos, grabación, quiz y validación: **PASS**,
  5 ficheros y 53 tests tras el último ajuste.
- `npx.cmd tsc --noEmit`: **PASS**.
- `npm.cmd run lint`: **PASS**, sin errores ni avisos.
- `npm.cmd run build`: **PASS**.
- comprobación sintáctica Node de WS, HTTP, LiveKit y validación quiz: **PASS**.
- `git diff --check`: **PASS**.
- exclusión Git de informes/auditorías `.local`: **PASS**.
- el build regeneró libros/metadatos con el script existente sin cambios
  materiales registrados en Git.
