# Dictámenes sobre H01–H04 y M01–M06

**29/09/2026 · 17:45**

Snapshot: `main`, `0623c7d9d1469404d0d138885df647e5c8064d45`. Cada dictamen se refiere a ese código. Se revisaron los diez hallazgos antes de buscar omisiones. No se presupone que una prueba verde signifique producto corregido: las nuevas aserciones reproducen su comportamiento actual.

## Criterio de valoración

**Confirmado** significa que la cadena causal central sobrevive al contraste. No extiende automáticamente la evidencia a hardware, SFU o interfaz completa. Clase **A**: ejecución independiente; **B**: reconstrucción estática; se explicita cuando una conclusión combina ambas. Severidad: High para caída del backend o autoridad privilegiada obtenida sin la credencial administrativa; Medium para pérdida de ediciones, regresión de estado, identidad local residual o elusión de una aprobación adicional por un actor que ya conoce la contraseña administrativa compartida. Esta graduación es juicio de riesgo, no una puntuación CVSS ni una medición de exposición del despliegue.

| ID | Veredicto Astra | Severidad anterior | Severidad Astra | Confianza anterior | Confianza Astra | Evidencia independiente | Causa raíz |
|---|---|---|---|---|---|---|---|
| H01 | CONFIRMADO | High | High | Confirmado / A | Confirmado / A | Backend hijo completo; ocho formas JSON; `evidence/H01-*.json` | R1: forma no validada antes de desreferenciar |
| H02 | CONFIRMADO | High | High | Confirmado / A | Confirmado / A, hasta JWT verificado | `H02.json`, `H02-controlled.json`; firma y campos independientes | R2: telemetría convertida en autoridad |
| H03 | CONFIRMADO | High | High | Confirmado / A, SDK simulado | Confirmado / A, hasta llamada SDK simulada | `H03.json`; HTTP real, ID público y controles negativos | R3: identificación pública usada como autenticador |
| H04 | CONFIRMADO, PERO MAL CLASIFICADO | High | Medium | Alta / B | Confirmado / A | `H04.json`; WS rechaza y HTTP aplica command/state/display | R3: autoridad desigual por transporte |
| M01 | CONFIRMADO | Medium | Medium | Confirmado / A | Confirmado / A servidor; B recarga cliente | `M01-soft.json`, `M01-hard.json`, `M01-http.json` | R4: rotación sin transición completa de conexiones |
| M02 | CONFIRMADO | Medium | Medium | Alta / B | Confirmado / A editor de audio; B presentaciones | `ui-results.json`; React real, HTTP 500, red y remontaje | R5: aceptación local sin resultado de persistencia |
| M03 | CONFIRMADO | Medium | Medium | Alta / B | Confirmado / A | `M03.json`; dos lectores y dos POST reales, backup | R6: reemplazo completo sin revisión esperada |
| M04 | CONFIRMADO | Medium | Medium | Confirmado / A hooks simulados | Confirmado / A React y DOM; transportes simulados | `ui-results.json`; GET/SSE, BC/SSE, duplicado | R7: estados válidos sin orden común |
| M05 | CONFIRMADO | Medium | Medium | Alta / B | Confirmado / A backend; B distribución UI/timeline | `M05.json`; GET, SSE operativo, guardado obsoleto | R8: falta invalidación; pérdida posterior comparte R6 |
| M06 | CONFIRMADO | Medium | Medium | Confirmado / A hook | Confirmado / A hook y storage sintético | `ui-results.json`; TTL, WELCOME, logout, rotación, dos instancias | R9: identidad y referencia de sesión con ciclos distintos |

## H01 — null termina el proceso compartido

**Intento de refutación.** Se contrastó que el parser, Basic, admisión, límites de tamaño o tratamiento de JSON inválido evitaran la caída. No lo hacen para `null`: `JSON.parse` tiene éxito y el primer acceso a `msg.type` sucede antes del gate de admisión. El catch del parseo ya terminó. El receptor instalado de `ws` emite el evento al callback sin absorber esa excepción.

**Código:** `server/ws-server.mjs:1405–1421`; creación compartida HTTP/WS en `server/local-server.mjs:1267`; `node_modules/ws/lib/websocket.js:1238`. No se encontró recuperación global aplicable en el código del servidor examinado.

**Reproducción y resultado:** Audience sin Basic, backend real aislado y auth global activada. Antes del frame, HTTP 200. `null` provoca exit 1 y `Cannot read properties of null`; después HTTP no conecta. Los otros siete casos (`true`, `1`, `"text"`, `[]`, `{}`, JSON malformado y PING válido) permiten PONG posterior y HTTP 200. El alcance es ese valor, no «cualquier JSON inválido».

**Impacto/precondición:** poder llegar al WS Audience basta en PUBLIC. El orden del código sitúa el fallo antes del gate CONTROLLED, aunque la matriz dinámica de H01 se ejecutó en PUBLIC. Caen las funciones HTTP/SSE/WS del proceso hijo; no se demuestra caída de SFU ni interrupción de un despliegue real.

**Corrección mínima y prueba posterior:** validar objeto no nulo/no array y tipo antes de cualquier desreferencia; mantener el resto de los validadores. Convertir la matriz en prueba de supervivencia: todos los casos deben permitir HTTP y un frame válido posterior. No sustituir esto por un `uncaughtException` que intente continuar un proceso con estado incierto.

## H02 — status de Audience contamina el grant firmado

**Código:** `server/ws-server.mjs:954–1024,1480`; `server/livekit-server.mjs:77–86,109,140–199,306–370`. La asociación al participante, la credencial de refresh y la admisión son controles reales; no determinan quién concede hablar.

**Cadena probada:** token listener → mismo participante informa status → refresh con su credencial → JWT firmado. Cada JWT resultante se verifica con `TokenVerifier` del SDK instalado. `LISTENER/false` conserva `canPublish=false`; `LISTENER/true` lo convierte en true; `GRANTED/false` también lo convierte en true. No hace falta falsificar simultáneamente ambos campos. Una credencial de refresh incorrecta recibe 403.

En CONTROLLED, sin admisión el token recibe 403. Tras ADMIT del principal, el listener obtiene inicialmente `canPublish=false`; informar GRANTED y refrescar lo cambia a true sin una concesión de habla. Admitir a la sesión no equivale a autorizar publicación. El vínculo a otra conexión, el estado expulsado y el circuito administrativo normal son compensadores para otros escenarios; no impiden esta cadena con identidad propia y no expulsada.

**Corrección factual del informe anterior:** el JWT **no lo emite el SDK**. `signJwt` usa `createHmac('sha256', ...)` en el propio programa; `issueToken` llama a esa función. El harness anterior decodificaba payload, sin verificar firma. La nueva prueba sí verifica firma, issuer y validación temporal mediante el SDK. Cambia la descripción de la evidencia, no el defecto.

**Límite:** grant firmado indebido confirmado; aceptación en un SFU y publicación audible no ejercitadas. No se presenta como «micrófono físico activado».

**Corrección mínima:** autoridad de publicación mantenida por el servidor y modificable solo por decisiones autorizadas; status técnico separado. Token inicial y refresh deben consultar esa misma autoridad. Conservar `credential → access record → participantId`. Probar status hostil, refresh, revocación, reentrada legítima y negativa de publicación en un entorno SFU de pruebas posterior.

## H03 — copiar un ID autorizado permite alcanzar moderación

**Código:** `server/authUtils.mjs:33`; `server/livekit-server.mjs:220–230,372`; difusión de ID en `server/ws-server.mjs:1306`. El guard exige que exista un Control autorizado, pero no demuestra que el solicitante sea ese Control. El espacio `/api/livekit/` está exceptuado del Basic general; los handlers de token privilegiado sí añaden su propio Basic, el de moderación examinado no.

**Prueba independiente:** principal y secundario se conectan con Basic sintético; Audience anónimo recibe el ID mediante anuncio de clave pública ECDH válido. El llamante HTTP no envía Basic. Se conserva el servidor HTTP exterior, Origin y todos los guards; solo se sustituye `RoomServiceClient.updateParticipant/removeParticipant` en su frontera final.

| Variante | Resultado |
|---|---|
| Sin ID / ID inexistente / ID PENDING | 403 |
| ID público de principal autorizado, body `role=control` | 200; llamada administrativa |
| Mismo ID con `role=audience` literal | 403; el rol declarado puede cambiarlo el llamante |
| Origin correcto / ajeno | 200 / 403 |
| ID del secundario después de APPROVE | 200 |
| ID autorizado cuyo socket se cerró | 403 |
| ID pendiente rechazado | 403 |
| ID anterior a rotación | 403 |

Tres llamadas `updateParticipant` alcanzadas. No se declara que un PENDING sea autorizado por su propio ID: precisamente no lo es. Tampoco existe en la ruta examinada una revocación específica de un Control ya AUTHORIZED; se probaron por separado rechazo de pendiente, cierre de autorizado y rotación.

**Impacto:** invocación indebida de la operación administrativa hasta el adaptador SDK. La rama de concesión se reprodujo; otras operaciones que comparten guard quedan sustentadas estáticamente, no por una modificación real del SFU. Un sitio externo queda limitado por Origin; un cliente local/modificado puede omitirlo y Audience ya está en el origen permitido.

**Corrección mínima:** autenticar y vincular la petición a una sesión Control autorizada mediante prueba privada, revocable y no anunciada como metadato público. No transformar el ID público en «secreto» ocultándolo parcialmente. Basic elimina el caso anónimo, pero por sí solo deja pendiente H04. Preservar tokens públicos de listener y denegar capacidades de sesión antigua.

## H04 — el Control pendiente conserva capacidad HTTP

**Código:** `server/local-server.mjs:617,654,703,905,931,947`; `server/ws-server.mjs:1718–1732`. Reducir un comando sin `sourceMeta` lo trata como admisible. El handler HTTP no vincula la petición con la autorización WS.

**Prueba:** principal y segundo Control, este último PENDING. El mismo `SELECT_PRESENTATION_AND_SLIDE` por WS recibe `CONTROL_PENDING_FORBIDDEN` y no modifica proyección. Por HTTP con Basic recibe 200 y GET confirma la slide. También se aplican POST de snapshot y telemetría display. Sin Basic HTTP devuelve 401; con Origin ajeno, 403. No hay un guard compensatorio posterior al reducer.

**Dictamen:** defecto confirmado y evidencia elevada de B a A. Severidad rebajada a **Medium**: el actor ya posee la contraseña administrativa compartida; el fallo rompe una aprobación adicional de sesión, mientras H03 permite llegar a administración sin esa contraseña. El impacto observado es control indebido del programa, no acceso al ordenador, ejecución de código ni persistencia arbitraria. Si el modelo operativo asigna confianza nula a todos los poseedores de Basic hasta aprobación individual, puede justificarse priorizarlo igual que un High; esa prioridad no cambia las precondiciones demostradas.

**Corrección mínima:** regla común por acción y principal, aplicada a HTTP y WS. Definir expresamente derechos de Presenter/media master para telemetría; no bloquearla exigiendo indiscriminadamente rol Control. El fallback HTTP necesita prueba privada válida o debe fallar de forma visible. Probar principal, delegado, pendiente, revocado y Audience en ambos transportes.

## M01 — rotación, sockets y recuperación divergen

**Código:** `server/ws-server.mjs:1737`; `src/hooks/useSyncState.ts:159`; `src/hooks/useControlAuthorization.ts`; `src/main-control.tsx:418`.

WS RESET con `clearSession=true` vacía autoridad. Tanto soft como hard dejan el socket abierto; el comando siguiente se rechaza y no llega una notificación de autorización actualizada. La prueba cierra y abre una nueva conexión: se registra un nuevo PRINCIPAL y vuelve a aplicarse el comando. El cliente programa recarga a 150 ms cuando recibe hardRefresh; esa instrucción se verificó por código, no ejecutando un navegador real. Por tanto, hardRefresh compensa mediante reentrada, no porque el servidor conserve correctamente la autoridad antigua.

HTTP RESET con los mismos flags responde 200 pero no rota `presentationSessionId`; el Control anterior sigue funcionando. Es divergencia de lifecycle por transporte, ya reconocida en M01, no una nueva vulnerabilidad separada. El bypass HTTP de H04 puede ocultar el problema, pero no constituye recuperación correcta.

**Severidad:** Medium, recuperable por reconexión. **Propuesta:** una operación de rotación con transición explícita de conexiones y UI, reutilizada por ambas entradas. Precisar cómo se vuelve a asignar principal; no conservar privilegios antiguos automáticamente. Validar soft/hard, varios Controls, Audience, claves y siguiente operación.

## M02 — persistencia fallida y aceptación optimista

**Código:** `src/main-audio-editor.tsx:69`; `src/main-control.tsx:325,345,468`; `src/App.tsx:609`; `src/components/control/MenuPopup.tsx:1467`.

El nuevo test monta **AudioEditorApp real con React real**. Sustituye el componente visual hijo por un observador de props y sustituye fetch; conserva carga, validación, callback de guardado y estado. POST resuelto con HTTP 500 deja `http-500-edit` visible en props/DOM sin alerta. Rechazo de red muestra una alerta pero conserva `network-edit` optimista. Un desmontaje/remontaje con GET de la copia persistida vuelve a `old`.

Presentaciones: inspección independiente confirma que `setPresentations` precede al resultado y que `handleSave` llama al guardado sin esperarlo y emite selección. `MenuPopup` hace `await onSave`, pero el callback real no devuelve la promesa del POST. Esperarlo no espera persistencia. No se encontró en esa ruta una confirmación de persistencia ni un estado dirty vinculado al resultado. No se afirma que el menú cierre siempre, que haya toast de éxito ni que una señal dirty concreta cambie: no se montó todo ese editor en la nueva prueba.

**Compensadores:** validación cliente rechaza estructuras inválidas; fetchJson comprueba GET; errores de red sí tienen catch. Ninguno convierte un HTTP 500 resuelto en fallo de guardado. `.bak` no repara un cambio que nunca llegó al disco.

**Propuesta:** resultado explícito del guardado, status comprobado, borrador conservado, error visible y selección/confirmación condicionada al éxito. Si se conserva preview optimista, distinguirlo del estado persistido. Probar 400/401/500, red, retry y dos saves solapados antes de generalizar un helper; no añadir librería de fetching.

## M03 — dos snapshots completos pierden cambios

**Código:** `src/main-control.tsx:125,345`; `server/local-server.mjs:1073`; `server/json-persistence.mjs:72`.

Backend completo con catálogo sintético en temporal: dos GET leen `[A0,B0]`; primer POST guarda `[A1,B0]`; segundo POST de la copia antigua guarda `[A0,B1]`. Ambos reciben 200. GET final devuelve `[A0,B1]`; `.bak` contiene `[A1,B0]`; no hay ETag. Esta prueba utiliza dos copias de datos independientes y HTTP real, no dos navegadores físicos.

**Intento de refutación:** escritura síncrona, archivo temporal, rename y backup pueden mantener JSON íntegro; no detectan una revisión obsoleta. Que las peticiones se serialicen no impide que el segundo contenido sea antiguo. Backup limita el daño recuperable, no impide pérdida silenciosa ni preserva historial completo.

**Propuesta:** revisión esperada comparada al commit y conflicto 409/412 con borrador intacto. Una revisión por catálogo es suficiente inicialmente; no empezar por CRDT, merge automático o base de datos. Contemplar clientes sin revisión de forma explícita, sin mantener indefinidamente un bypass legacy.

## M04 — validación y deduplicación no ordenan snapshots

**Código:** `src/hooks/useSyncState.ts:474,567,606,680,694`. Prueba nueva con `useState`, `useRef` estables y setters reales: SSE nuevo muestra `p:1`; GET viejo posterior muestra `p:0`, y localStorage persiste 0. Otro test entrega SSE nuevo y BC antiguo con distinto ID: revierte a 0. Con el mismo ID, BC se descarta correctamente; un SSE posterior vuelve a 1.

**Compensadores reales:** validación de formato, descarte del propio clientId y deduplicación de IDs. No ordenan IDs diferentes. `no-store` evita caché HTTP, no una respuesta en vuelo. No se requiere desorden dentro de una conexión SSE. El harness anterior capturaba setters y almacenamiento con estado simplificado; el resultado sobrevive al componente React real.

**Propuesta:** revisión monotónica del servidor y epoch de sesión, comparados en un aplicador común de snapshot. Un guard de request generation puede mitigar el GET retrasado, pero no resuelve por sí solo BC antiguo tras SSE. No usar el reloj de cada dispositivo como autoridad. Telemetría parcial requiere reglas específicas para no perder datos legítimos al compararla como snapshot completo.

## M05 — mapas persistidos sin invalidación general

**Código:** `server/local-server.mjs:1046,631,1346`; `src/main-control.tsx:468`; `src/main-audio-editor.tsx:69`; `src/hooks/useSyncState.ts:635`.

POST real cambia mapas; GET lee copia nueva. Se abre SSE y, después del guardado, se fuerza un evento de proyección con marcador `barrier`: llega, pero no aparece `AUDIO_SYNC_MAPS_UPDATE`. No se concluye «canal caído»: está operativo. Una copia anterior que cambia solo el nombre puede guardar con 200 y restaurar el cue antiguo. El handler persiste y asigna caché, sin emitir invalidación.

**Separación de capas:** archivo y caché servidor se actualizan; `syncTimelineToSlideSelection` y `evaluateServerCues` consultan esa caché, comprobado en código. No se ejecutó reproducción de audio ni se midió el timeline físico. Control integrado emite BC optimista, que ayuda solo dentro del ámbito local de ese canal; el editor independiente ni siquiera emite ese evento. Actualización de timeline no distribuye el catálogo editable a otras UIs. No se simularon dos navegadores remotos completos.

**Relación causal:** no invalidar explica la copia UI vieja; aceptar el guardado obsoleto comparte R6 con M03. Son arreglos diferentes: impedir overwrite no actualiza UI y actualizar UI no elimina todas las carreras de guardado. Mantener M05 como hallazgo, sin contar su pérdida posterior como una segunda pérdida independiente.

**Propuesta:** invalidar/revisar tras commit exitoso por un transporte servidor ya existente, releer, y preservar borradores ante conflicto. No un bus adicional ni sustitución del transporte entero.

## M06 — el alias sobrevive a la referencia expirada

**Código:** `src/hooks/useAudienceSession.ts:14,29,49,78`; `src/utils/privacyStorage.ts:34,54`; `docs/privacy/technical-privacy-specification.md:65`.

Matriz con hook real: referencia vigente y misma sesión conserva alias; vigente y sesión distinta lo borra; referencia expirada con sesión igual o distinta conserva alias. El cuarto argumento de `writeExpiringStorage` es el instante de creación, no un TTL: el harness se corrigió para probar realmente ambas condiciones. El intento inicial fallido permanece documentado y no se atribuye al producto.

Logout explícito elimina storage y estado del hook que lo ejecuta; rotación recibida también. Dos instancias del hook con almacenamiento compartido muestran que borrar desde una no actualiza el estado de la otra, ni enviando un evento `storage`; la segunda sí se limpia al recibir rotación. Es evidencia de falta de reconciliación en el hook, no una prueba E2E con dos pestañas físicas.

**Impacto:** reutilización de identidad local en un navegador compartido, retención superior a la documentación «solo memoria». No prueba publicación automática del alias, acceso a secretos ni incumplimiento jurídico. La ruta privada de envío y la preferencia de visibilidad siguen siendo controles distintos.

**Propuesta:** cumplir la política de memoria y purgar claves legadas, o decidir expresamente persistencia con TTL/frontera de sesión coherentes y documentación correspondiente. No añadir otra identidad Audience. Validar reentrada, TV, perfil compartido, dos contextos y logout/rotación.

## Balance

Sobreviven los diez núcleos causales; nueve conservan clasificación y H04 baja a Medium. Ningún ID se refuta ni se subsume por completo: hay causas compartidas que deben evitar arreglos duplicados, pero también fallos independientes. Se corrige la atribución del firmante de H02 y se refuerzan H04, M02, M03 y M05 con ejecución propia, dentro de los límites indicados.
