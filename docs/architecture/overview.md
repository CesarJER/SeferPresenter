# Arquitectura actual

SeferPresenter combina clientes web con un backend local para proyección, control,
audiencia y edición. El backend aplica los comandos de proyección soportados;
Presenter y Audience renderizan su estado. Live Audio y Voice Scripture son opcionales.

Esta referencia describe responsabilidades actuales. Para sintaxis y autorización
consulte [API](../api/README.md); para transporte y recuperación, [sincronización](synchronization.md).

## Unidades runtime y navegación

| Unidad | Entrada y responsabilidad | Límite |
| --- | --- | --- |
| Control | `/control`, [main-control](../../src/main-control.tsx), [App](../../src/App.tsx): edición, comandos, administración y preview | La UI local y el borrador del editor no son autoridad servidor |
| Presenter | `/presenter`, [main](../../src/main.tsx), [PresenterScreen](../../src/components/presenter/PresenterScreen.tsx): renderizado y telemetría del medio real | No es requisito para aplicar navegación Control → Audience |
| Audience | `/audience`, [main-audience](../../src/main-audience.tsx), [AudienceScreen](../../src/components/audience/AudienceScreen.tsx) | Solo lectura de proyección; interacción de quiz/admisión/audio separada |
| Editor de audio | `/audio-editor`, [AudioEditorApp](../../src/main-audio-editor.tsx) | Edita mapas persistidos; no convierte su draft en estado canónico sin guardar |
| Catálogo público | Rutas configuradas; [CatalogApp](../../src/components/catalog/CatalogApp.tsx), [builder servidor](../../server/public-presentations-builder.mjs) | Copias filtradas por contenido y tags, distintas del catálogo administrativo |
| Documento legal | `/proteccion-datos`, [DataProtectionPage](../../src/components/shared/DataProtectionPage.tsx) | Consulta pública, incluida antes de participar |
| Backend Node | [local-server](../../server/local-server.mjs), [reducer](../../server/projection-state-reducer.mjs), [WS](../../server/ws-server.mjs) | Estado vivo, persistencia de catálogos, permisos y contratos HTTP/SSE/WS |
| Audio sincronizado | [timelineManager](../../server/timelineManager.mjs), [useAudioTimeline](../../src/hooks/useAudioTimeline.ts) | Timeline separada de audio capturado en Live Audio |
| Live Audio | [módulo](../../src/features/liveAudio/), [API LiveKit](../../server/livekit-server.mjs), LiveKit/Redis opcionales | El SDK y las pistas no pertenecen al reducer de proyección |
| Voice Scripture | [módulo](../../src/features/voiceScripture/), [gateway](../../server/voice-scripture-server.mjs), STT local instalado por operador | Una fuente seleccionada; principal transcribe; corpus valida la referencia |
| Proxy/PWA | [Caddy](../../Caddyfile), [service worker](../../static/audience-sw.js) | Caché del shell no garantiza disponibilidad offline de estado o audio vivo |

## Responsabilidades en el codebase

`App.tsx` coordina estado y rutas. Los componentes de `src/components/control/`
editan y emiten intención; los de `presenter/` renderizan desde props; los de
`audience/` combinan la proyección recibida con interacción permitida.

Los hooks en `src/hooks/` coordinan ciclos de vida. Las utilidades en `src/utils/`
contienen parsing, normalización, validación y cálculos compartidos. Los contratos
están en `src/types/`; sus tipos no sustituyen la validación runtime.

En Scripture, `MenuPopup` mantiene una instancia de `useSeferControlLogic` por
contexto de navegación. Los paneles completo y compacto reciben ese controlador
por props; conservan solo estado visual, como abrir el ajuste de fuentes. Mover
u ocultar un panel no reinicia selección, rango ni carga del corpus. El host
elige la política del único atajo de teclado; cada vista conserva su política
de navegación manual o proyectada. El estado canónico sigue en el backend.
Los datos portables de Scripture están en `src/types/scripture.ts`, sin React.

Los widgets compartidos de texto, preview y documento legal permanecen en
`src/components/shared/`. Los widgets dependientes de Live Audio están en
`src/features/liveAudio/components/`. El canal crypto compartido
[usePrivateControlSignals](../../src/hooks/usePrivateControlSignals.ts) y
[cryptoUtils](../../src/utils/cryptoUtils.ts) utiliza Web Crypto y el transporte
existente; no necesita importar el SDK LiveKit al núcleo.

## Ownership de datos y estado

Aquí ownership significa responsabilidad técnica; no asignación a una persona.

| Estado | Autoridad / almacenamiento | Consumidores y límites |
| --- | --- | --- |
| Presentaciones, mapas de audio | Catálogos de `SEFER_DATA_DIR`; [persistencia](../../server/json-persistence.mjs) | Edición con ETag/If-Match; guardado y estado proyectado son operaciones distintas |
| Proyección viva, slide, modos, fondos, scripture y quiz sincronizado | Backend/reducer; espejos en clientes | Volátil en backend; espejo del navegador no es respaldo completo |
| Timeline de audio | Backend/timelineManager | Cada dispositivo reproduce/corrige localmente; autoplay y dispositivos afectan resultado |
| Telemetría audio/video/display | Medio real en Presenter o Control elegible; backend redistribuye | Observación ligera, distinta de permisos y de persistencia |
| Paneles, drawers, foco, scroll, selección del editor | Cliente local | No deben entrar en SYNC_STATE por conveniencia |
| Pasos, layouts, etiquetas, cues y texto calculado | Derivado de datos y estado vigente | Preferir cálculo puro a otro estado sincronizado redundante |
| Alias, mensajes y claves privadas de Control | Clientes y canal E2E | El servidor enruta ciphertext; no es fuente de alias legibles |
| Admisión, moderación, snapshot operacional y agregados de quiz | RAM servidor y estados técnicos permitidos | No equivale a almacenar mensajes o respuestas individuales |
| Respuestas/puntuaciones de quiz | Navegador con TTL; contribuciones anónimas para agregados | Recuperación parcial depende de dispositivos que regresen |
| Preferencia de escucha de Control | Cliente local | No concede micrófono ni cambia media-master |
| Corpus, branding y medios del operador | Árbol privado servido `SEFER_DATA_DIR/public/` y branding | «Fuera de Git» no significa «no publicado» |
| Publicaciones legales | Repositorio del operador y activación validada | Fuente legal, hashes y límites en [privacidad](../privacy/README.md) |

## Trust boundaries y dependencias

El contenido servido de `public/`, branding, catálogo público y documento legal
cruza hacia visitantes. Revise explícitamente qué publica la instancia.
El cliente valida imports y mensajes; el backend comprueba autoridad y los campos
que sus handlers aplican. No asumir validación idéntica entre TypeScript y backend.

La credencial de operador activo para estado, comandos y telemetría HTTP depende
de una conexión WS autorizada activa. Los catálogos administrativos utilizan
Basic y ETag, sin exigir esa credencial.
Audience utiliza otra credencial y tickets de admisión. Tokens LiveKit y capacidad
STT son otros límites, con permisos y caducidades propios. El formato UUID no
demuestra autorización.

LiveKit recibe audio de micrófono; el STT local recibe PCM de la fuente elegida.
Ninguna integración acredita por sí sola el almacenamiento, los logs ni el
cumplimiento del entorno externo. La configuración operativa y las excepciones
de diagnóstico están en [operación](../operations/deployment.md) y
[especificación de privacidad](../privacy/technical-privacy-specification.md).

## Decisiones y mantenimiento

Véanse [ADR](../adr/README.md) para autoridad, separación de datos, credenciales
y orden de snapshots. Actualice esta página cuando cambien unidades runtime,
límites o ownership; la lista de símbolos se descubre en el código siguiendo
[desarrollo](../development/guide.md), sin mantener otro catálogo exhaustivo.
