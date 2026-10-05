# Auditoría técnica integral de SeferPresenter

**29/09/2026 · 17:30**  
**Objeto:** código de `main`, `0623c7d9d1469404d0d138885df647e5c8064d45`.  
**Entrega:** informe, propuestas y pruebas de evidencia; sin implementar correcciones.

## 1. Resumen ejecutivo

SeferPresenter tiene una arquitectura funcional y comprobable: el backend reduce los comandos de proyección, Audience recibe la diapositiva activa y Live Audio/Voice Scripture son módulos opcionales. Hay validación de contenido, autenticación predeterminada, tickets Audience de un uso, persistencia con copias y pruebas sustanciales.

El principal problema está en las fronteras de autoridad. La política de Control cambia según se use WebSocket o HTTP; algunos permisos de publicación se reconstruyen desde telemetría de Audience; la moderación HTTP confunde un identificador público con una credencial. Además, un JSON `null` recibido por WebSocket provoca una excepción que termina el proceso aislado.

**Hallazgos: 0 Critical, 4 High, 6 Medium y 0 Low.** No se impone una cuota de problemas. Los High son H01–H04; H01–H03 tienen reproducción aislada y H04 tiene una cadena de código completa, sin ejercicio del servidor operativo.

La suite existente ejecutada pasó: **61 archivos, 486 tests**. Se excluyó el archivo del generador de corpus por sus escrituras. Otras **6 comprobaciones adversariales** reprodujeron defectos: cuatro escenarios Node y dos tests de hooks. Que esas comprobaciones pasen significa que el defecto existe; no que esté corregido.

TypeScript de aplicación y configuración pasó. ESLint dio 0 errores y 3 advertencias. No se hizo build, despliegue ni prueba sobre servicios activos. Docker solo se leyó como configuración.

Los problemas de guardado y concurrencia pueden hacer perder ediciones; el orden entre GET y SSE puede revertir la proyección local. Los mapas de audio no se invalidan de forma uniforme entre dispositivos. Un alias persistente sobrevive a la caducidad de la referencia de sesión, en contradicción con la especificación técnica.

La primera mejora debe ser cerrar H01–H04 con cambios pequeños y pruebas negativas. Después, confirmar guardados, rechazar ediciones obsoletas y ordenar snapshots. No se recomienda cambiar de framework, introducir una base de datos, un bus nuevo ni una arquitectura distribuida para resolver estos hallazgos.

## 2. Estado inicial y alcance autorizado

| Elemento | Evidencia |
|---|---|
| Checkout | `C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter` |
| Rama / HEAD | `main` / `0623c7d9d1469404d0d138885df647e5c8064d45` |
| Estado inicial | `git status --short` vacío |
| Inventario versionado | 311 archivos; 137 en `src`, 20 en `server`, 62 en `__tests__` |
| Grafo actualizado | Indexación del checkout con persistencia desactivada: 2.931 nodos y 6.589 relaciones |
| Runtime de comprobación | Node `v24.15.0`; dependencias ya instaladas |
| Escrituras autorizadas | Exclusivamente los entregables de esta auditoría en `docs/audits/2026-09-29` |
| Correcciones del producto | No autorizadas; no realizadas |

El índice ayuda a descubrir símbolos y llamadas, pero no prueba por sí mismo el comportamiento de red, las referencias dinámicas o el código de carpetas excluidas. Se contrastó con las implementaciones y el inventario físico. Los hallazgos se formularon contra este HEAD; las auditorías anteriores no se usaron como evidencia de defectos.

Se leyeron componentes, hooks, servidores, validadores, persistencia, service worker y configuración. No se leyó el contenido de credenciales del operador ni se copió su catálogo al informe. La observación del navegador fue pasiva. Las reproducciones usaron datos sintéticos, mocks de SFU y puertos efímeros de loopback.

## 3. Mapa de fronteras

| Frontera | Entrada / confianza | Control observado | Límite o hallazgo |
|---|---|---|---|
| Navegador → HTTP Node | JSON, rutas, Basic/Bearer | `requireAuth`, comprobación Origin, validadores y límites | H03–H04: autenticación y autorización no equivalen |
| Navegador → `/ws` | JSON no confiable | Origin, rol de conexión, Basic para roles privilegiados, tamaño máximo | H01: dereferencia antes de validar el objeto |
| Audience → estado/quiz | Credencial de sesión y tickets | Digest SHA-256, admisión, ticket de propósito y uso único | No es un identificador de hardware ni garantía de una persona por respuesta |
| Audience → permisos de audio | Estado técnico comunicado por cliente | Validación sintáctica, vínculo de participante | H02: se transforma en autoridad para emitir JWT |
| Control → moderación HTTP | `role`, `controlSessionId`, participante | Búsqueda de ID de Control autorizado | H03: no demuestra quién realiza la petición |
| Node → SFU | SDK con secreto servidor | Actualización de permisos antes de comunicar concesión en el flujo normal | SFU real no ejercitado; las llamadas del harness son mocks |
| Pestaña → pestaña | BroadcastChannel del mismo origen | Validación, IDs y roles en receptores | Canal local; no autenticación fuerte entre pestañas del mismo origen |
| GET / SSE → estado React | Snapshot y eventos | Validación de estructura, deduplicación parcial | M04: sin revisión monotónica entre transportes |
| Edición → JSON del operador | Catálogo o mapas completos | Normalización, validación, `.bak`, rename/fallback | M02–M03: éxito y concurrencia no confirmados de extremo a extremo |
| Runtime → disco de operador | `SEFER_DATA_DIR`, corpus, branding/legal | Directorios separados, inicialización sin sobrescribir existentes | No se auditó el contenido ni los permisos efectivos del volumen operativo |
| Voice Scripture → STT | Audio y resultados | Capability corta, Origin/Basic, sesión única, colas acotadas | Motor real, precisión y latencia no medidos |
| Declaración de emisión → grabación externa | Estado declarado y manifiesto | Avisos, reglas del producto, manifiesto opcional | No demuestra qué graba OBS, el sistema operativo o terceros |

## 4. Arquitectura reconstruida

```text
Control ── intención REMOTE_COMMAND ── WS preferido / HTTP fallback ─┐
                                                                  v
Presenter ── telemetría DOM ─────────────────────────────> Node local-server
                                                        currentState + reducer
                                                        timeline + quiz en RAM
                                                                  |
                          ┌───────────────────────────────────────┼───────────┐
                          v                                       v           v
                    SSE completo                           SSE minimizado   WS técnico
                    Control/Presenter                      Audience        roles/audio
                          ^                                       ^           ^
                          └──── GET snapshot inicial ─────────────┘           |
                                                                             |
Pestañas mismo origen <──────── BroadcastChannel ─────────────────────────────┘

Edición ── POST catálogo/mapas ── validación ── JSON + .bak en SEFER_DATA_DIR
Corpus/medios/branding/legal <──────── archivos del operador y recursos estáticos

Live Audio: navegador <── JWT / refresh / moderación ── Node ── SDK ── LiveKit
            navegador <──────────────── WebRTC ──────────────────── SFU
Privado:    Audience <──── ECDH + AES-GCM, transporte WS ────> Controls autorizados
Voice:      Control ── gateway de audio opcional ── STT ── parser/hidratación
                                                            └── SCRIPTURE_PROJECT
```

`src/main-control.tsx`, `src/App.tsx`, `src/main-audience.tsx` y `src/main-audio-editor.tsx` son superficies distintas. `useSyncState` conecta estado React, canales y snapshots. El estado canónico de proyección reside en `local-server`; Presenter puede emitir telemetría y estados, pero la navegación Control → Audience ya no necesita un Presenter que ejecute cada comando.

`ws-server` mantiene admisión, participantes, Controls, claves públicas y permisos técnicos. `livekit-server` mantiene otra representación de participantes/sala para tokens y SDK. Esa separación es útil, pero requiere una autoridad única para los permisos: H02 demuestra que actualmente se pierde al copiar un status a la representación que firma tokens.

El producto usa `static` como recursos propios y `SEFER_DATA_DIR` para contenido del operador. `data-directory.mjs` crea estructura y copia ejemplos solo cuando falta el destino. Por ese efecto lateral no se importó ni arrancó `local-server` en las reproducciones.

## 5. Fuentes de verdad

| Estado | Productor | Autoridad | Consumidores | Persistencia | Canal | Riesgo |
|---|---|---|---|---|---|---|
| Proyección/diapositiva/modo | Comandos y telemetría | `currentState` y reducer Node | Control, Presenter, Audience | RAM servidor; copia local parcial | GET, SSE, BC; entrada WS/HTTP | M04; IDs sin orden global |
| Catálogo de presentaciones | Editor Control/Presenter | JSON validado del operador | Editor, selección, catálogo público filtrado | JSON y `.bak`; caché Node | HTTP; estado de selección | M02–M03 |
| Mapas/cues | Editor integrado o independiente | JSON y caché Node | Timeline y UI | JSON y `.bak`; copias React | HTTP + BC en un editor | M05 |
| Reloj/timeline | Acciones Node y telemetría | `timelineManager` | Reproductores y Control | RAM | WS + estimación de reloj | Exactitud física sin medir |
| Autoduck | Detección/configuración y estado | Estado funcional compartido; aplicación local de volumen | Media master/reproductores | Estado de sesión | Comando/estado | No se midieron ganancia ni eco |
| Principal/delegados | Registro/decisiones Control | `liveAudioControls` | WS, UI, API LiveKit | RAM | WS; consulta HTTP del ID | H03–H04, M01 |
| Admisión Audience | Bootstrap + decisión autorizada | `audienceAccessRecords` | Estado, SSE, quiz, tokens | Digest en RAM; credencial en navegador | HTTP + WS + señal privada | Retención/capacidad sin medir |
| Speaker/canPublish | Moderación y status técnico | Debe ser servidor; actualmente también cliente | JWT y SFU, UI | RAM/JWT | WS + HTTP | H02 |
| Alias privado | Usuario y cifrado cliente | Perfil local y Controls que descifran | Inbox/listas privadas | Claves/mensajes en RAM; nick local persistido | Señal privada WS | M06; servidor conoce metadatos |
| Quiz individual | Audience | Respuestas y puntuación local | UI Audience | Envolturas con TTL | localStorage; agregados HTTP | No es un examen con integridad certificada |
| Quiz agregado | Mensajes validados y deduplicados | Node | Control y publicación agregada | RAM, hashes por ámbito | HTTP/SSE | Reinicio pierde RAM; no se prueba una persona por voto |
| Referencia sagrada | Control/voz y corpus | Estado proyectado; corpus para hidratación | Todos los visores | Corpus + estado funcional | Comando normal/estado | Corpus operativo no regenerado |
| Transcripción de voz | STT opcional | Parser + metadata + confirmación de proyección | Control | RAM; debug puede llevarla a consola | WS separado, no sync principal | Retención externa desconocida |
| Emisión/grabación declarada | Control | Estado de producto y manifiesto opcional | Avisos/participantes | RAM; manifiesto `.local.json` si configurado | WS + disco | Declaración no verifica captura externa |

## 6. Consistencia, autoridad, orden, versiones y reconexión

**Invariantes reconstruidas:** Audience no muta proyección; un Control pendiente no opera hasta autorización; un listener no obtiene permiso de publicar sin concesión; guardar exige confirmación de persistencia; una revisión antigua no sustituye otra más reciente; limpiar sesión no deja autoridad invisible y sockets válidos con UI obsoleta.

H01–H04 y M01–M04 violan varias de estas invariantes. No existe una única comprobación de autorización compartida por todos los transportes. El `protocolVersion: 1` describe formato, no una versión de estado. `timestamp` y `messageId` no constituyen una revisión total del servidor; algunos timestamps entran desde cliente y los receptores no los usan para rechazar regresiones.

La deduplicación BC/SSE recuerda 100 IDs y elimina el primero al superar el límite. No es idempotencia permanente ni orden causal. Los comandos no tienen una protección general contra doble reducción/reintento en el servidor. El quiz sí tiene hashes de submission y ámbitos de sesión/presentación; no debe extrapolarse esa propiedad a la proyección.

WebSocket reconecta con retardos de 1, 2, 4, 8, 16 y hasta 30 segundos; cleanup cancela timer y socket. HTTP es fallback al enviar cuando WS no está abierto. No hay una cola durable de intenciones con acuse de aplicación. Un envío aceptado por `socket.send` no demuestra reducción ni recepción por Audience.

SSE aporta el estado renderizado y heartbeat; al reconectar Audience requiere renovar tickets. Un WS sano por sí solo no sustituye toda la entrega de `SYNC_STATE`: `handleWsMessage` atiende mensajes técnicos/timeline, y el estado de proyección se aplica por SSE/BC/snapshot. Si falla SSE, puede quedar la imagen anterior aunque los controles o mensajes técnicos sigan funcionando.

Con dos Controls autorizados, el servidor aplica los comandos en su orden de llegada, sin aislamiento de la intención de cada operador. Para editar, cada cliente envía el catálogo entero: M03. Varias pestañas comparten BC/localStorage, pero los dispositivos distintos no comparten ese canal: M05.

Una recarga reabre conexión y pide estado; no garantiza conservar permisos de sesión ni recuperar intenciones no confirmadas. La copia local del navegador permite restauración parcial, pero no debe prevalecer sobre una revisión canónica posterior. M04 demuestra una regresión incluso con mensajes válidos.

## 7. Flujos críticos de extremo a extremo

| Flujo | Recorrido observado | Resultado y punto frágil |
|---|---|---|
| Seleccionar/navegar | UI Control → `emitCommand` → WS/HTTP → reducer → commit → SSE minimizado → Audience | Funciona por backend; H04 y M04 afectan autoridad/orden |
| Añadir texto sagrado | Control construye slide → `handleSave` → catálogo HTTP + selección normal | No depende del Presenter; M02–M03 afectan guardado |
| Verso manual/voz | Metadata/libro → referencia validada/hidratación → `SCRIPTURE_PROJECT` → reducer → estado | Parser y carreras tienen tests; corpus y voz física no verificados |
| Audio de programa | Acción timeline → Node → `AUDIO_TIMELINE_STATE` → aplicador DOM/media master → telemetría | Separar control lógico de reproducción audible; M05 afecta cues/UI |
| Quiz | Selección/subslide/reloj → estado → respuesta local → agregado HTTP validado/deduplicado → SSE | Agregación con límites y tamaño mínimo; no prueba identidad humana única |
| Admisión privada | Bootstrap → credential vinculada a WS → clave Control → alias cifrado → decisión → tickets → estado/token | Gates existen; H01 entra antes de admisión, M06 afecta identidad local |
| Conceder palabra | Control → HTTP SDK actualiza `canPublish` → WS `GRANT` → refresh/captura/publicación Audience | Flujo normal espera SDK; H02/H03 eluden su autoridad |
| Reconectar audio | Ciclo de habitación, timers, token/credencial, callbacks por run | Protecciones y retry visibles; éxito audible no certificado |
| Limpiar sesión | Logo Control → `RESET_STATE(clearSession)` → reducer + rotación WS | M01 deja Controls abiertos sin registro; HTTP tiene semántica distinta |
| Guardar mapas | Editor → POST `/api/audio-sync` → JSON/caché Node | M02 ignora HTTP fallido; M05 no invalida otros clientes |

## 8. Hallazgos Critical / High

### H01. Un JSON `null` de Audience termina el proceso WebSocket

**Severidad:** High. **Confianza:** Confirmado. **Clase:** A, código y ejecución aislada. **Tipo:** disponibilidad / validación de frontera.

**Referencias:** [ws-server.mjs:1333](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1333), [ws-server.mjs:1405](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1405), [ws-server.mjs:1418](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1418).

**Flujo/activación:** conexión Audience pública → frame de cuatro bytes `null`. `JSON.parse` acepta el valor; el try/catch solo cubre el parseo. La siguiente lectura de `msg.type` lanza una excepción fuera de esa protección.

**Actual / esperado:** el hijo Node termina con exit 1 y `Cannot read properties of null`; debería rechazar el frame conservando el servicio. En el producto, HTTP/SSE/WS comparten proceso: el impacto potencial incluye proyección, admisión y estado en RAM. No se afirma caída del SFU, que es otro servicio.

**Refutación/compensadores:** Basic de Control no se exige a Audience; la admisión se evalúa después de la dereferencia; el límite de 64 KiB no evita `null`; Origin no identifica a un cliente autorizado. No se encontró manejador global que convierta esta excepción en rechazo seguro. El harness confirma terminación, no un mero error registrado.

**Reproducción:** `adversarial-checks.mjs`, escenario `null-message`, sin auth Audience y con autenticación global habilitada sintéticamente. **Cobertura:** parcial en seguridad WS; faltaba este payload.

**Estrategia mínima:** validar objeto no nulo/no array y tipo antes de cualquier acceso; rechazar forma inválida en la frontera compartida. **Riesgo de regresión:** bajo, pero preservar todos los mensajes válidos. **Validación posterior:** primitives, arrays, JSON malformado y mensaje válido posterior en el mismo servidor; verificar que todos los sockets/HTTP siguen operativos.

### H02. Audience puede convertir su status técnico en permiso firmado de publicación

**Severidad:** High. **Confianza:** Confirmado. **Clase:** A. **Tipo:** autorización / integridad de permisos.

**Referencias:** [ws-server.mjs:925](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:925), [ws-server.mjs:954](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:954), [ws-server.mjs:1480](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1480), [livekit-server.mjs:342](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/livekit-server.mjs:342), [livekit-server.mjs:109](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/livekit-server.mjs:109).

**Flujo/activación:** listener con su identidad y refresh credential válidos → status WS `speakerState=GRANTED`, `canPublishAudio=true` → refresh HTTP. La validación de status comprueba valores, pero los guarda como permisos. El refresco copia esos campos al participante que se usa para firmar JWT.

**Actual / esperado:** JWT inicial `video.canPublish=false` pasa a `true` sin ningún Control. Debe mantenerse `false` hasta concesión autorizada del servidor. PUBLIC basta; en CONTROLLED el actor necesita admisión para superar ese gate. La admisión no equivale a permiso de hablar.

**Impacto:** emisión de credencial con capacidad indebida. El JWT real fue emitido por el SDK instalado; no se publicó sonido ni se conectó un SFU real. Esa última explotación física sigue pendiente.

**Refutación/compensadores:** la refresh credential protege identidad de refresh, no quién concede permiso; el guard del cliente honesto no protege un cliente modificado; UUID válido y misma identidad se mantuvieron en la prueba; ninguna decisión Control intervino.

**Reproducción:** `audience-self-grant` en el harness. **Cobertura:** parcial; los tests de grant/revoke no cubrían status falsificado seguido de refresh.

**Estrategia mínima:** separar telemetría de autoridad: Audience informa captura/mute/error, pero no concede `speakerState`/`canPublish`. El token debe derivarse exclusivamente de permisos servidor. Conservar el flujo existente credential → access record → participantId. **Regresión:** reentrada de un speaker legítimo; no perder concesiones válidas ni convertir un listener en speaker. **Validación:** status malicioso, refresh, revoke y rejoin; después, publicación negativa en SFU aislado.

### H03. La moderación HTTP acepta un ID público como prueba de autoridad

**Severidad:** High. **Confianza:** Confirmado. **Clase:** A, SDK de administración simulado. **Tipo:** autenticación / autorización.

**Referencias:** [authUtils.mjs:33](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/authUtils.mjs:33), [livekit-server.mjs:220](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/livekit-server.mjs:220), [livekit-server.mjs:372](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/livekit-server.mjs:372), [ws-server.mjs:1306](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1306).

**Flujo/activación:** principal autorizado anuncia clave pública → Audience recibe `controlSessionId` → petición anónima de moderación con `role=control` y ese ID. Todo `/api/livekit/` está exento de Basic en el guard general. El handler de moderación no comprueba Basic y solo pregunta si el ID pertenece a un Control autorizado.

**Actual / esperado:** `grant-speak` devuelve 200 e invoca `updateParticipant` sin credencial Basic del solicitante. Debe demostrar autenticación y pertenencia/autoridad del caller, no solo existencia de otro Control. El ID es metadato distribuido al público y no puede funcionar como secreto.

**Impacto:** actor Audience puede invocar administración de permisos; las ramas de revoke/kick/rescue comparten guard. La llamada SDK se comprobó con mock: no se alteró una sala real.

**Refutación/compensadores:** se habilitó auth global en la prueba; token de Control sí tiene comprobación Basic adicional, moderación no; Origin bloquea ciertos sitios externos, pero no un Audience del propio origen ni una petición sin Origin. El Caddyfile leído no añade una barrera de autenticación para estas rutas.

**Reproducción:** `forged-moderation`; Control con Basic sintético, Audience sin Basic, ID obtenido por su WS. **Cobertura:** parcial; faltaba esta combinación de ruta pública e ID divulgado.

**Estrategia mínima:** autenticar operaciones mutantes y vincular HTTP a la autorización real del solicitante. Una capability privada de Control ligada al registro autorizado, revocable y nunca difundida a Audience, puede conservar el fallback; añadir solo Basic no cierra H04 frente a otro Control pendiente que conoce la contraseña compartida. **Regresión:** preservar tokens públicos de listener y moderación legítima. **Validación:** anónimo, ID copiado, Control pendiente, autorizado, revocado y session rotation.

### H04. Un Control pendiente puede eludir la aprobación usando HTTP

**Severidad:** High. **Confianza:** Alta. **Clase:** B, cadena de código comprobada; no ejercitada contra `local-server`. **Tipo:** autorización / diferencia entre transportes.

**Referencias:** [ws-server.mjs:1718](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1718), [ws-server.mjs:1728](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1728), [local-server.mjs:617](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:617), [local-server.mjs:654](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:654), [local-server.mjs:931](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:931), [local-server.mjs:703](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:703).

**Flujo/activación:** segundo Control conoce Basic, pero permanece PENDING en WS → envía un comando válido a `/api/command`. `requireAuth` comprueba la contraseña; la ruta llama `reduceRemoteCommandMessage(parsed)` sin metadatos de autoridad. `canReduceRemoteCommand(undefined)` devuelve `true`. `/api/state` POST tiene además un camino directo de commit tras su validación mínima.

**Actual / esperado:** la política de rechazo de Controls pendientes de WS no se aplica en HTTP. Si la aprobación es una frontera de autoridad, debe regir todos los transportes. Conocer Basic permite solicitar acceso; el protocolo WS establece explícitamente que todavía no autoriza a mutar proyección.

**Impacto:** el aislamiento entre principal/delegado/pendiente puede eludirse para modificar proyección y estados. Requiere contraseña válida: no se confunde con acceso anónimo ni con H03.

**Refutación/compensadores:** Basic y Origin existen, pero son satisfechos por ese actor. La validación de command comprueba forma, no delegación. No hay middleware posterior que complete la autoridad antes del commit. La causa no es una carrera ni una conjetura de red; sí queda sin prueba integral del handler en un backend descartable.

**Reproducción conceptual:** conservar PENDING y mandar por HTTP el mismo comando que WS rechaza; observar reducción y SSE. **Cobertura:** no cubierta en equivalencia de permisos WS/HTTP; pruebas WS existentes no bastan.

**Estrategia mínima:** usar un mismo guard de autoridad para todas las mutaciones, incluido POST state/telemetría; HTTP debe presentar prueba privada vinculada al Control autorizado o rechazar mutación sin ella. Definir explícitamente cómo opera Presenter. **Regresión:** fallback legítimo/reconexión y telemetría del media master. **Validación:** matriz principal/delegado/pendiente/Presenter/Audience sobre ambos transportes y sobre rotación.

## 9. Hallazgos Medium

### M01. Limpiar sesión sin recarga deja Controls conectados pero sin autoridad

**Severidad:** Medium. **Confianza:** Confirmado. **Clase:** A. **Tipo:** lifecycle / recuperación / UX.

**Referencias:** [MenuPopup.tsx:2059](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/control/MenuPopup.tsx:2059), [main-control.tsx:418](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:418), [ws-server.mjs:1737](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/ws-server.mjs:1737), [useSyncState.ts:159](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts:159), [useControlAuthorization.ts](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useControlAuthorization.ts).

**Flujo/activación:** reset con `clearSession=true`, `hardRefresh=false`. El servidor vacía `liveAudioControls`, pero conserva sockets y sus antiguos IDs. El siguiente comando se rechaza. La UI no recibe un nuevo WELCOME ni un registro que actualice su autoridad. `broadcastAuthorizationState` no informa a registros ya eliminados.

**Actual / esperado:** socket abierto, cero Controls registrados y error `CONTROL_PENDING_FORBIDDEN` al siguiente comando. Debe cerrar/reestablecer de forma visible la sesión de Control o reconstruir autoridad según la política elegida. Una recarga manual puede recuperar; por eso no se eleva a High.

**Impacto:** interrupción de control tras una acción válida y representación obsoleta de permisos. HTTP RESET solo reduce/limpia el ámbito quiz; no ejecuta la misma rotación WS.

**Refutación:** hard refresh sí puede reconectar; no cubre el reset sin ese flag. **Reproducción:** escenario `reset-control`. **Cobertura:** parcial; faltaba reset seguido de otro comando en el socket existente.

**Estrategia mínima:** unificar la operación de rotación entre entradas y notificar una transición que provoque reentrada/autorización visible. **Regresión:** cierre de Audience, clave privada y sucesión de principal. **Validación:** reset normal/forzado por HTTP/WS, dos Controls y siguiente operación.

### M02. El guardado local ignora respuestas HTTP fallidas

**Severidad:** Medium. **Confianza:** Alta. **Clase:** B. **Tipo:** pérdida de datos / confirmación de éxito.

**Referencias:** [main-control.tsx:325](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:325), [main-control.tsx:354](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:354), [App.tsx:609](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx:609), [main-audio-editor.tsx:69](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-audio-editor.tsx:69), [main-control.tsx:468](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:468), [local-server.mjs:1046](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:1046), [local-server.mjs:1073](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:1073).

**Activación:** servidor devuelve 400/401/500 al guardar. `fetch` resuelve normalmente; los handlers no leen `response.ok`. Se actualiza React antes y, en presentaciones, se emite selección sin esperar resultado. El editor independiente solo alerta ante rechazo de la promesa, no ante HTTP 500.

**Actual / esperado:** cambio visible/proyectable en memoria sin persistencia; debería conservarse borrador y mostrarse fallo/reintento hasta confirmación. No se afirma que exista un toast literal de éxito: la señal engañosa es la aceptación funcional del cambio.

**Impacto:** edición perdida al recargar; mapas divergentes. Los validadores cliente y `.bak` servidor no ayudan cuando no hubo commit. **Reproducción conceptual:** responder 500 sintético y recargar; no se provocó fallo de disco real. **Cobertura:** parcial en validación/persistencia; no cubierta de extremo a extremo en UI con respuesta fallida.

**Estrategia mínima:** comprobar status y propagar éxito/error en las rutas existentes, reutilizando el patrón `fetchJson` donde proceda; esperar confirmación antes de cerrar/seleccionar como guardado y conservar borrador. **Regresión:** doble click, latencia y edición durante guardado. **Validación:** 400/401/500, caída de red, dos saves rápidos y reintento sin perder texto.

### M03. Dos editores sobrescriben cambios ajenos al guardar el catálogo entero

**Severidad:** Medium. **Confianza:** Alta. **Clase:** B. **Tipo:** concurrencia / integridad de datos.

**Referencias:** [main-control.tsx:125](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:125), [main-control.tsx:345](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:345), [local-server.mjs:1073](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:1073), [json-persistence.mjs:72](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/json-persistence.mjs:72).

**Activación:** dos clientes cargan `[A,B]`; uno guarda `[A',B]`; otro, con copia antigua, guarda `[A,B']`. El segundo POST reemplaza la lista completa sin revisión esperada y restaura A antiguo.

**Actual / esperado:** ambos saves pueden ser válidos y exitosos, pero la primera edición desaparece. Debe rechazarse el catálogo obsoleto o aplicarse una actualización que preserve el otro cambio.

**Impacto:** pérdida silenciosa de ediciones concurrentes. **Compensadores:** persistencia sincrónica/rename protege integridad física, no versiones; la `.bak` ofrece recuperación limitada del estado inmediatamente anterior, no prevención. La lista React no se actualiza con revisiones del catálogo de otros clientes.

**Reproducción:** conceptual, sin escribir el catálogo del operador. **Cobertura:** no cubierta para dos lectores/saves del catálogo. **Estrategia mínima:** revisión/ETag + compare-and-reject con 409/412 y conservar borrador; antes que merge automático o base de datos. **Regresión:** clientes antiguos y guardado tras importación. **Validación:** dos editores cambian presentaciones distintas y la misma; el obsoleto recibe conflicto y no sobrescribe.

### M04. Un GET retrasado revierte un estado más nuevo recibido por SSE

**Severidad:** Medium. **Confianza:** Confirmado. **Clase:** A en hooks con transportes simulados. **Tipo:** orden / sincronización / persistencia local.

**Referencias:** [useSyncState.ts:474](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts:474), [useSyncState.ts:567](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts:567), [useSyncState.ts:680](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts:680), [useSyncState.ts:717](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts:717).

**Activación:** GET inicial captura slide 0 y demora respuesta; SSE entrega slide 1; después resuelve GET con slide 0. Ambas formas son válidas y tienen IDs distintos.

**Actual / esperado:** las llamadas de actualización son `[1,0]` y localStorage acaba en 0; debería mantenerse la revisión reciente. El test usa una presentación sintética de dos slides y el hook real, sin red operativa.

**Impacto:** una pantalla retrocede y conserva copia vieja hasta nuevo evento/snapshot. **Refutación:** deduplicación no ordena IDs distintos; timestamp no se compara; `cache: no-store` no evita respuesta en vuelo vieja. No es necesario que SSE entregue fuera de orden en su propio stream.

**Reproducción:** segundo test de `runtime-evidence.test.ts`. **Cobertura:** no cubierta antes; tests previos del hook comprobaban igualdad/caminos, no la carrera.

**Estrategia mínima:** revisión monotónica emitida por servidor y comparación común al aplicar GET/SSE/BC; sesión/epoch para reinicio. No usar reloj de cliente como revisión. **Regresión:** cambio de sesión, media telemetry y mensajes parciales. **Validación:** GET viejo/nuevo, evento durante reconnect, duplicados y reset de epoch.

### M05. Guardar mapas de audio no actualiza uniformemente a otros clientes

**Severidad:** Medium. **Confianza:** Alta. **Clase:** B. **Tipo:** sincronización de configuración / UX de cues.

**Referencias:** [main-control.tsx:468](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:468), [main-control.tsx:481](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-control.tsx:481), [main-audio-editor.tsx:69](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/main-audio-editor.tsx:69), [local-server.mjs:1046](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:1046), [local-server.mjs:635](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/local-server.mjs:635).

**Activación:** guardar en otro dispositivo o en `/audio-editor`. El POST cambia archivo/caché Node y responde 200, pero no emite invalidación/map update servidor. Control integrado solo publica BC; el editor independiente no lo hace.

**Actual / esperado:** Node usa mapas nuevos para cues bilaterales mientras otras UIs conservan su carga inicial. Deberían adoptar una revisión confirmada o indicar necesidad de recarga.

**Impacto:** editar o inspeccionar cues desactualizados y riesgo de sobrescribirlos en el siguiente save. **Refutación:** BC solo alcanza pestañas del mismo origen/partición y no cubre editor independiente; actualizar timeline no sustituye el catálogo de mapas de la UI.

**Reproducción:** conceptual, no se guardaron mapas reales. **Cobertura:** parcial en aplicación del timeline; no cubierta en distribución del catálogo entre editores/dispositivos.

**Estrategia mínima:** tras persistir con éxito, emitir invalidación/revisión por el canal servidor existente y releer mapas. Evitar otro canal o broadcast optimista previo al commit. **Regresión:** borradores abiertos y selección de mapa activo. **Validación:** editor independiente + Control remoto; UI actualizada sin reload y sin pisar borrador.

### M06. El alias local persiste y puede cruzar una sesión expirada

**Severidad:** Medium. **Confianza:** Confirmado. **Clase:** A en hook real. **Tipo:** privacidad / lifecycle / deriva documental.

**Referencias:** [useAudienceSession.ts:14](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceSession.ts:14), [useAudienceSession.ts:49](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceSession.ts:49), [useAudienceSession.ts:78](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceSession.ts:78), [privacyStorage.ts:34](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/privacyStorage.ts:34), [technical-privacy-specification.md:65](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/privacy/technical-privacy-specification.md:65).

**Activación:** alias en `sefer-audience-nick`, referencia de sesión caducada y WELCOME de otra sesión. `readExpiringStorage` elimina la referencia vieja y devuelve null. La comparación solo borra identidad cuando existe un ID local diferente. El nick se lee/escribe sin envoltura ni TTL.

**Actual / esperado:** continúa `isLoggedIn=true` con alias viejo en la sesión nueva. La especificación dice que alias/visibilidad permanecen solo en memoria; el código los persiste en localStorage. Debe aplicarse la política elegida coherentemente y no heredar identidad tras expiración.

**Impacto:** retención local superior a la descrita y reutilización involuntaria en un navegador compartido. No se afirma una infracción legal ni exposición pública automática del texto: su envío normal sigue por canal privado.

**Refutación:** logout y rotación recibida sí borran; el caso es perder/caducar la referencia mientras permanece el nick. **Reproducción:** primer test de `runtime-evidence.test.ts`. **Cobertura:** parcial en TTL/session; faltaba alias residual con referencia expirada.

**Estrategia mínima:** si la política es memoria, dejar de persistir nick/visibilidad y purgar claves legadas; si se decide persistir, TTL y límites de sesión coherentes y documentación exacta. **Regresión:** reentrada, TV y preferencia de visibilidad. **Validación:** sesión nueva, TTL, logout, dos pestañas, legacy y navegador compartido.

## 10. Hallazgos Low

No se admite ningún Low como defecto confirmado. Las tres advertencias de dependencias de hooks son señales para revisión, no evidencia suficiente de fallo funcional. No se recomienda añadir dependencias automáticamente a sus arrays sin comprobar estabilidad y propósito.

## 11. Hallazgos que aparecen al combinar subsistemas

| Combinación | Causa que no muestra un test aislado de un módulo |
|---|---|
| WS status + HTTP refresh + JWT | H02: un booleano de telemetría termina convertido en grant criptográficamente firmado |
| Clave pública WS + excepción auth HTTP + SDK | H03: el ID divulgado sirve indebidamente como prueba de autoridad |
| Aprobación WS + fallback HTTP | H04: cada transporte implementa una política distinta |
| Reset + registros + socket/UI | M01: borrar autoridad no genera reentrada en sockets que siguen abiertos |
| Edición React + respuesta HTTP + recarga | M02: aceptación en memoria sobrevive al fallo hasta que se pierde al recargar |
| Dos catálogos locales + reemplazo completo | M03: escrituras físicamente seguras pueden destruir cambios válidos |
| GET + SSE + persistencia navegador | M04: validación y deduplicación correctas no proporcionan orden |
| JSON cues + timeline servidor + BC local | M05: el motor y sus controles pueden ver configuraciones distintas |
| Nick sin TTL + session envelope con TTL | M06: caduca el dato usado para detectar frontera, pero no la identidad |

## 12. Seguridad

La autenticación está habilitada por defecto; las rutas privilegiadas generales y roles WS Control/Presenter tienen Basic. No se recomienda abrirlas ni desactivar Origin. El CSP, `nosniff`, `frame-ancestors 'none'`, validadores de contenido y límites de mensajes son defensas reales, pero no compensan los fallos de autoridad.

Audience público es una superficie prevista. Debe tolerar clientes modificados y payloads arbitrarios. H01 no exige un atacante autenticado; H02 exige una identidad listener propia; H03 exige conocer un ID difundido y un participante; H04 exige contraseña válida y evita una aprobación adicional. Las precondiciones son distintas.

Los mensajes privados emplean ECDH P-256 y AES-GCM, con nonces y control de repetición tras descifrado. El servidor enruta ciphertext y metadatos. No se detectó en los flujos inspeccionados una ruta normal que envíe alias claros en `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`. Esto no prueba resistencia contra un servidor/distribuidor de claves comprometido ni contra un Control autorizado malicioso.

La contención de rutas usa `resolve` + `relative`; la inicialización rechaza symlinks en la estructura que crea/verifica. No se demostró traversal remoto. No se certifica toda modificación física futura del árbol ni ACLs efectivas. Las entradas HTML normales se sanitizan mediante allowlist/DOMPurify; no se reprodujo XSS.

No se consultaron advisories remotos ni se ejecutó auditoría de dependencias en red. Por tanto, no hay afirmación de ausencia de CVE. Tampoco se certifican fuerza/rotación de contraseña, TLS efectivo, firewall o exposición del host.

## 13. Privacidad y mapa de datos

| Dato | Lugar y receptores | Retención/observación |
|---|---|---|
| Contenido del operador/corpus | `SEFER_DATA_DIR`; Node y visores autorizados/públicos según ruta | JSON, archivos, backups; no se inspeccionó contenido privado |
| Diapositiva activa | Snapshot/events Audience | Se reduce la lista a la activa, no es una anonimización del contenido de esa slide |
| Catálogo público | Presentaciones con tags permitidos | Builder excluye slides quiz/media y campos de media; sin tags permitidos devuelve vacío |
| Credencial Audience | Navegador; digest servidor | Scope de presentación; no identidad civil. TTL de navegador no equivale a eliminación física inmediata |
| Tickets SSE | sessionStorage/cadena de URL de conexión; mapa RAM | Un uso, propósito y 30 s; pueden existir metadatos de URL en capas externas |
| Alias/visibilidad | Navegador; Controls o participantes autorizados tras descifrar | M06 contradice la retención descrita |
| Participante/Control IDs | WS, RAM, JWT/metadatos | Seudónimos correlacionables durante sesión, no datos anónimos |
| Quiz | Respuestas/puntuaciones navegador; agregados/hashes RAM | TTL configurable 1–168 h, por defecto 24 h; lectura/logout/rotación purgan según flujo |
| Claves privadas/mensajes privados | Refs/estado cliente | No se encontró persistencia de claves privadas en el hook inspeccionado; no se certifica memoria del navegador/terceros |
| Audio LiveKit | Captura cliente y SFU | No se observó grabador nativo en los flujos revisados; SFU/cliente externo pueden tratar audio |
| Audio/transcripción STT | Gateway y motor configurado | RAM en flujo normal; modo debug imprime payloads/eventos a consola |
| Manifiesto de recording | Directorio configurado, `.local.json` | Versiones, política/hash, canales, inicio/fin; no incluye voz/alias/asistentes por esquema |
| Logs/proxy/runtime | Consola y runtime externo | Configuración estática acota archivos por tamaño; retención por edad y ejecución del mantenimiento no verificadas |

`audienceAccessRecords` se conserva en RAM hasta limpiezas de sesión; la búsqueda por credencial recorre registros. Los tickets no consumidos caducan para autorización, pero no se observó un barrido temporal de todos esos elementos. No se hizo carga ni medición de memoria: el crecimiento en sesiones largas es un límite a medir, no un incidente de agotamiento probado ni un hallazgo High adicional.

La política jurídica/operativa efectiva del despliegue, legitimación de grabaciones, información a asistentes y contratos con proveedores no pueden determinarse a partir de estos archivos. No se incluyen identidades, dominios ni contenidos de la instancia observada en navegador.

## 14. LiveKit y audio

El módulo distingue estado de conexión, permisos, track, mute y escucha. `useLiveAudio` contiene run IDs para callbacks de conexión, timers, cleanup de habitación/track/procesador y un retry explícito. La UI normal comprueba permisos antes de publicar. La concesión administrativa normal espera que el SDK acepte permiso SFU antes de emitir el mensaje de concesión; ese orden es un mecanismo compensatorio válido frente a publicación prematura, pero H02/H03 crean caminos diferentes.

La administración combina petición HTTP y mensaje WS posterior. No es una transacción atómica entre SFU, RAM WS y UI; una respuesta/segundo canal perdido requiere reconciliación. No se reprodujo una desincronización física de SFU durante la auditoría y no se presenta como otro defecto confirmado.

La captura/publicación de micrófono tiene pasos asíncronos; las carreras con revocación, mute, permisos del navegador o desmontaje merecen validación con un track simulado y posteriormente hardware. No se demostró que un micrófono quedase capturando ni que un usuario emitiera audio tras mute. Tampoco se atribuye latencia a WebRTC, filtros o CPU sin medir cada etapa.

Program audio, microphone audio y salida elegida son rutas diferentes. Un indicador de conexión o JWT correcto no prueba sonido audible. TV/Chromecast, `setSinkId`, autoplay, Bluetooth, cancelación de eco, music mode, ducking y mezcla requieren dispositivos/navegadores reales. Los tests actuales no certifican esas condiciones físicas.

**Propuesta mínima:** resolver autoridad servidor primero; luego medir captura, procesamiento, publicación y negociación separadamente. Mantener escucha y recuperación visible cuando falle administración. No sustituir LiveKit ni introducir una segunda identidad/canal de Audience.

## 15. Resiliencia, errores y recursos

| Fallo | Conducta reconstruida | Límite |
|---|---|---|
| HTTP de guardado falla | Catch de red; respuestas no OK ignoradas en rutas citadas | M02; borrador/confirmación insuficientes |
| HTTP snapshot falla | `requestBackendState` devuelve false; se solicita estado por canal local | Sin otro cliente reciente puede quedar copia vieja |
| SSE falla | EventSource/reconexión; Audience renueva ticket con callback | WS abierto no garantiza actualización de proyección |
| WS falla | Backoff y fallback HTTP para envío | H04; no cola durable ni acuse general de aplicación |
| SFU/token falla | Estados/error y retry del módulo | Sonido/renegociación real no ejercitados |
| Proceso Node reinicia | Se reabren clientes; se recarga contenido persistido | Proyección, permisos y agregados en RAM no son recuperación durable |
| Disco falla | Persistencia prepara backup y devuelve error | M02 puede ocultarlo a UI; fallo físico no provocado |
| Rename no permitido | Fallback in-place con backup fsynced | El código declara menor atomicidad; no es seguro prometer supervivencia del primario a corte de corriente |
| Cliente SSE lento | Gestión de escritura/drain y coalescencia | No se midió carga ni se certifica cada intercalado heartbeat/evento |
| Voz satura cola | Límite de bytes, cierre y cleanup de ambos sockets | Calidad/latencia bajo carga no medidas |

WebSocket controller cancela timer al cleanup; SSE cierra su EventSource; gateway voz cierra ambos extremos. No se observó `.close()` del BroadcastChannel creado en `useSyncState`; la eliminación de listeners no demuestra un cierre explícito. No se hizo perfil de memoria, por lo que se registra como límite de lifecycle por verificar, no fuga cuantificada.

Las lecturas síncronas, serialización de catálogos, hidratación de ranges y búsquedas lineales pueden costar tiempo según tamaño. No se recomiendan workers/Go/Redis adicional sin medición. El número de líneas o funciones no es evidencia de cuello de botella.

## 16. UX y accesibilidad

La observación pasiva encontró una pantalla Control cargada con controles semánticos y nombres accesibles. No se pulsaron controles, guardó contenido, concedieron permisos, disparó audio ni reinició sesión. No se comprobó que el bundle servido corresponda a este HEAD.

En código hay diálogos con foco, restauración y atrapado de Tab en mensajes privados, errores visibles de moderación/carga y validación de contenido. Eso aporta evidencia local, no certificación WCAG completa.

M01 y M02 tienen consecuencias claras de UX: UI autorizada obsoleta y edición aceptada antes de confirmación. Las mejoras propuestas deben mostrar estado real de guardado/reentrada sin un rediseño. Los errores de infraestructura no deberían quedar solo en consola cuando el usuario necesita decidir reintentar.

**Sin verificar:** teclado en todos los menús, lector de pantalla, contraste medido, zoom 200–400 %, viewport móvil, orientación, touch, RTL con contenido real, foco tras fallo de guardado y rutas de escucha/autoplay. Se omitieron las interacciones que alteraban la sesión activa; no se etiquetan como aprobadas.

## 17. Tests, comandos, resultados y huecos

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Suite existente, excluyendo generador | 61 archivos / 486 tests pasan; 155,33 s | [tests-existing.txt](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/audits/2026-09-29/tests-existing.txt) |
| Harness adversarial Node | 4 escenarios reproducidos | [adversarial-results.txt](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/audits/2026-09-29/adversarial-results.txt) |
| Hooks con transportes/storage sintéticos | 2 tests reproducen M04 y M06 | [runtime-results.txt](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/audits/2026-09-29/runtime-results.txt) |
| TypeScript aplicación | Exit 0, sin diagnósticos | [typecheck-app.txt](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/audits/2026-09-29/typecheck-app.txt) |
| TypeScript configuración | Exit 0, sin diagnósticos | [typecheck-node.txt](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/audits/2026-09-29/typecheck-node.txt) |
| ESLint del checkout inicial | 0 errores, 3 warnings | [lint.txt](C:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/docs/audits/2026-09-29/lint.txt) |

Comandos reproducibles desde la raíz; no iniciar `dev` ni `local-server` para estas pruebas:

```powershell
node node_modules/vitest/vitest.mjs run __tests__ --config docs/audits/2026-09-29/vitest.audit.config.ts --configLoader runner --maxWorkers 2
node docs/audits/2026-09-29/adversarial-checks.mjs
node node_modules/vitest/vitest.mjs run docs/audits/2026-09-29/runtime-evidence.test.ts --config docs/audits/2026-09-29/vitest.audit.config.ts --configLoader runner --maxWorkers 1
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit --incremental false
node node_modules/eslint/bin/eslint.js .
```

La configuración auxiliar conserva React y las pruebas existentes, usa caché en temporal del sistema y excluye `__tests__/generateVerses.test.ts`. Es un runner de auditoría, no cambio del producto. El harness usa contraseña/secreto sintéticos, URL inválida de SFU, puertos aleatorios de loopback y mock administrativo; no carga `.env` del operador.

Se omitieron `npm run build`/`build:web` porque sus prehooks generan corpus, y el test del generador porque escribe datos. No se ejecutaron scripts de limpieza, pingpong, infraestructura o mantenimiento. Los tests inspeccionados crean temporales propios o mockean servicios; no probaron la instalación operativa.

Huecos prioritarios: forma adversarial de mensajes WS; status Audience → refresh; moderación sin Basic y con ID copiado; PENDING sobre HTTP; reset seguido de operación; 500 de guardado en UI; dos editores; snapshot en vuelo; invalidación de mapas remotos; identidad residual tras TTL. Las advertencias ESLint afectan dos effects de `PresenterScreen` y un callback de `useSeferReader`; necesitan contexto antes de modificar arrays.

## 18. Código muerto y candidatos de eliminación

| Categoría | Resultado | Decisión |
|---|---|---|
| Eliminable con seguridad demostrada | Ningún componente completo confirmado como muerto | No recomendar eliminación irreversible sin referencias/entrypoints/tests |
| Probablemente legado | `SCRIPTURE_ADD_SLIDE` como side effect de Presenter, frente al guardado directo vigente de Control | Revisar emisores/importaciones/rutas legacy antes de borrar el contrato; no afirmar que la función normal depende de él |
| Probablemente redundante | Guardado/validación de presentaciones duplicados en App y Control; guardado de mapas en dos superficies | Simplificar comportamiento compartido tras corregir M02, sin refactor transversal |
| Indeterminado | Launcher, artefactos de build, ejemplos, scripts operativos y ramas solo activadas por flags | No bastan cero referencias estáticas o ausencia en una sesión |

Los campos de exportación y contratos pueden consumirse mediante mensajes, imports dinámicos o herramientas externas. El grafo no justifica por sí solo borrarlos. No se borró nada.

## 19. Simplificaciones recomendadas y no recomendadas

1. Una validación de forma WS antes del switch evita guards dispersos por cada caso.
2. Una regla de autoridad servidor para permisos de hablar evita reconciliar grants confiando en status del cliente.
3. Un guard común de autorización de mutación HTTP/WS elimina políticas divergentes; no crear un servicio de identidad separado.
4. Un resultado explícito de guardado y la comprobación de `response.ok` en las rutas existentes bastan antes de añadir una librería de data fetching.
5. Revisión de catálogo y rechazo de copia vieja antes de merge automático o almacenamiento nuevo.
6. Invalidar/releer mapas por un canal ya existente antes de sincronizar todo el editor con un bus adicional.

**No recomendado ahora:** migración React/servidor, Redux global, WebSocket sustituyendo SSE como refactor masivo, base de datos para todo el estado, CRDT, event sourcing, microservicios/Go, nuevo `deviceId` Audience, reescritura del parser, sustitución de LiveKit o una campaña de borrar dependencias sin medir uso. No resuelven las causas admitidas con el menor riesgo.

## 20. Deriva entre documentación e implementación

| Documento / afirmación | Implementación | Evaluación |
|---|---|---|
| Especificación privacidad: alias/visibilidad solo en memoria | `useAudienceSession` los escribe en localStorage | Contradicción confirmada M06 |
| Arquitectura: Control autorizado gobierna permisos | Moderación confía en ID divulgado; status Audience alimenta JWT | Garantía incompleta H02–H03 |
| Estado canónico backend y fallback HTTP | Reducer backend existe; autorización de fallback es distinta | Arquitectura real, garantía de permisos no uniforme H04 |
| Persistencia segura y backups | Rename y `.bak`; fallback explícito menos atómico | No convertir el término «segura» en garantía absoluta ante corte de corriente |
| Live Audio descrito en parte como familia «ready» por fases | Runtime actual incluye SDK, tokens, moderación y hooks | Contexto por fases puede quedar desactualizado; actualizar descripción tras fixes |
| Audio/transcripciones transitorias | Flujo normal en RAM; debug explícito puede loguear contenido | Documento de voz reconoce la excepción; no se admite fuga secreta por defecto |

La revisión documental se hizo después de trazar los flujos; una declaración de «verificado» en un documento no se tomó como prueba de ejecución en esta auditoría.

## 21. No verificable o deliberadamente omitido

No se ejecutó ningún comando Docker, incluido status/config/logs/inspect; no se consultó ni alteró un servicio activo. Dockerfile, Compose y Caddyfile aportan únicamente evidencia estática de intención: imagen Node, usuario no root, separación de volúmenes, puertos/configuración SFU/Redis y proxy.

Quedan sin comprobar: imágenes efectivas, healthchecks reales, versiones ejecutadas, volúmenes/ACLs, persistencia de backups tras recreación, rutas/credenciales cargadas, reglas firewall, TLS/dominio, NAT/TURN/UDP, Redis efectivo, logrotate/retención por edad, reinicios/cortes y backup restoration real.

Tampoco se verificaron SFU audible, permisos de micrófono reales, dispositivos TV, carga/memoria prolongada, motor STT, latencia y exactitud de referencias de voz, política legal activa de operador, CVEs actuales ni todas las rutas de navegador/viewport. No hay certificación de despliegue o accesibilidad. La observación de una pestaña cargada no identifica su revisión servida.

## 22. Hipótesis descartadas y límites que no se inflaron a hallazgos

| Hipótesis | Intento de refutación | Resultado |
|---|---|---|
| «Audience descarga toda la presentación proyectada» | `makeAudienceSyncStateMessage` sustituye slides por la activa y reindexa | Descartada para snapshot/events públicos; el contenido de la activa sigue público según admisión |
| «Control necesita un Presenter para navegar» | Ruta Control → reducer → commit/SSE; tests del reducer | Descartada para comandos soportados de navegación |
| «Añadir texto sagrado no funciona desde otro dispositivo» | `main-control:367–400` construye y guarda directamente | Descartada para el handler actual; el comando side effect legacy no prueba ese fallo |
| «Aplausos solo viajan por BC» | Reducer convierte comando a `feedbackSound` en estado | Descartada como fallo de transporte del comando normal; sonido físico no comprobado |
| «Todo HTTP es público» | `isProtectedRequestPath` y `requireAuth` | Descartada; excepciones concretas H03, no exposición total |
| «Abrir control.html concede autoridad» | APIs/WS privilegiados siguen teniendo guards | Descartada como prueba suficiente de acceso privilegiado |
| «Un frame JSON malformado siempre termina Node» | Parseo está atrapado; se probó específicamente JSON válido `null` | Descartada la generalización; H01 tiene causa distinta |
| «El cliente siempre recibe GRANTED antes del SDK» | `doModerationAction` espera HTTP y handler espera SDK | Descartada para flujo normal; H02/H03 son caminos alternativos |
| «Refresh ajeno no necesita credencial» | `hasValidRefreshCredential` y pruebas de seguridad | Descartada; H02 usa la credencial propia de listener |
| «Tokens/voz/legal quedan cacheados por SW» | Exclusiones `/api`, tokens, RTC, SSE y legal; tests PWA | Descartada para las rutas cubiertas por esas reglas |
| «Todo recurso media acaba persistido por navegación» | Media runtime es network-only en SW | Descartada como regla general; lista explícita de instalación puede cachearlo |
| «JSON se sobrescribe sin copia» | `writeJsonSafely` prepara/fsync backup y maneja rollback | Descartada; M03 es pérdida lógica, no ausencia de backup |
| «No hay cleanup de red/audio» | Timers/socket/Room/EventSource y gateway tienen cleanup | Descartada la afirmación general; no se certifican todas las carreras |
| «Nickname normal se manda claro por WS técnico» | Validador de perfil y señales E2E | No demostrado en flujo inspeccionado; no inferirlo desde IDs públicos |
| «Hay fuga permanente de tracks, outage por memoria o cuello CPU» | Lectura lifecycle y límites; sin profiling/carga física | No admitidas como defectos confirmados; pendientes de medición |

Clase D estricta: las seis pruebas adversariales ejecutadas no descartaron defectos; los reprodujeron. Las hipótesis descartadas de esta tabla se refutaron por código y, donde existe, cobertura de la suite; no se les atribuye una reproducción física que no se realizó. No quedaron observaciones de ejecución con causa desconocida que justifiquen un hallazgo clase C.

## 23. Matriz de prioridad

| Prioridad | ID | Problema | Severidad | Confianza | Impacto | Esfuerzo relativo |
|---|---|---|---|---|---|---|
| P0 | H01 | `null` termina proceso | High | Confirmado | Disponibilidad de backend compartido | Pequeño |
| P0 | H02 | Status listener concede JWT publish | High | Confirmado | Permiso de audio indebido | Pequeño/medio |
| P0 | H03 | Moderación por ID público | High | Confirmado | Administración sin autenticación de caller | Medio |
| P0 | H04 | PENDING evade aprobación por HTTP | High | Alta | Proyección sin autorización delegada | Medio |
| P1 | M02 | Respuesta fallida de save ignorada | Medium | Alta | Edición perdida tras recarga | Pequeño |
| P1 | M03 | Catálogo completo obsoleto pisa edición | Medium | Alta | Cambios ajenos perdidos | Medio |
| P1 | M04 | GET viejo revierte SSE nuevo | Medium | Confirmado | Pantalla/copia local obsoleta | Medio |
| P1 | M01 | Reset conserva sockets sin autoridad | Medium | Confirmado | Control interrumpido hasta reentrada | Pequeño/medio |
| P1 | M06 | Alias cruza expiración de sesión | Medium | Confirmado | Retención/reuso de identidad local | Pequeño |
| P2 | M05 | Mapas nuevos no llegan a otras UI | Medium | Alta | Cues/edición divergentes | Pequeño/medio |

P0 señala el primer bloque de correcciones propuestas, no un incidente activo demostrado. Esfuerzo es una estimación de alcance, no tiempo prometido. No se considera trivial un cambio de autoridad que deba preservar rejoin/fallback.

## 24. Próximas acciones: máximo diez

1. H01: validar la forma del mensaje en la frontera WS y convertir su prueba de reproducción en test de no terminación.
2. H02: hacer los grants exclusivamente servidor y probar status falsificado → refresh negativo.
3. H03: demostrar identidad/autoridad del caller en moderación, conservando tokens públicos de escucha.
4. H04: aplicar la misma política de Control/Presenter en HTTP y WS; cubrir copia de ID y Control pendiente. Coordinar con H03 por compartir autoridad HTTP.
5. M02: confirmar cada save, preservar borrador y mostrar fallo/reintento; probar 500 y red antes de continuar UI.
6. M03: añadir control de revisión para catálogo completo con rechazo explícito de versión vieja.
7. M04: asignar revisión/epoch del servidor y rechazar snapshots obsoletos en el aplicador común.
8. M01: centralizar reset/rotación y asegurar reentrada visible de todos los Controls afectados.
9. M06: alinear storage de alias con política y purgar claves legadas/identidad tras TTL.
10. M05: invalidar mapas tras commit por canal existente; después validar audio físico y recuperación en un entorno autorizado separado.

Estas acciones son propuestas. Ninguna se implementó en esta entrega. Ejecutarlas en cambios pequeños, con una comprobación de regresión por causa raíz, resulta suficiente; no se necesita una campaña de refactor para empezar.

## 25. Certeza, cobertura y límites de la conclusión

**Evidencia A:** H01, H02, H03, M01, M04 y M06. H01 reproduce caída de un hijo aislado; H02 inspecciona JWT firmado; H03 llega a un mock de SDK; M01 prueba sockets/registros; M04/M06 prueban hooks reales con entorno simulado. No son pruebas de audio físico ni del despliegue activo.

**Evidencia B:** H04, M02, M03 y M05. Se reconstruyeron entrada, autoridad, condición y efecto por implementación, con mecanismos compensatorios buscados. No se ejecutaron saves o ataques sobre datos/servidor reales. La confianza Alta no equivale a una explotación de producción observada.

La cobertura es amplia en fronteras de proyección, autorización, persistencia, quiz, storage, audio y voz; es parcial en combinaciones físicas de dispositivo, carga, despliegue y accesibilidad. No significa lectura exhaustiva de cada línea ni certificación de todos los subsistemas. No se prometen ausencia de defectos restantes ni equivalencia de mocks con SFU/browser reales.

**Verificación del checkout:** rama y HEAD conservados; `git diff --exit-code` sin diferencias en archivos versionados. El estado final contiene únicamente archivos nuevos de esta auditoría en `docs/audits/2026-09-29`. No hubo cambios de código/configuración del producto, commits, push, reset, despliegue ni comandos Docker. Caché del runner y temporales de pruebas quedaron fuera del contenido operativo, en temporales del sistema.

La conclusión útil es concreta: conservar la arquitectura y corregir sus fronteras de autoridad/confirmación/orden. Las pruebas verdes existentes son una base de regresión; las seis evidencias nuevas explican por qué todavía no bastan para dar por seguras esas fronteras.
