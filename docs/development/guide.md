# Trabajar sobre SeferPresenter

Guía común para colaboradores y agentes de IA. Empiece por
[arquitectura](../architecture/overview.md), y abra solo las referencias relevantes
para la modificación. Las tareas de operación están en [despliegue](../operations/deployment.md).

La interfaz dispone de [catálogos i18n y guía de contribución](i18n.md). El idioma
local no se sincroniza con la presentación ni modifica el corpus de sefer.

## Antes de cambiar código

Desde la raíz del checkout:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
```

Lea las instrucciones aplicables del repositorio y de la sesión. Preserve todos
los cambios preexistentes, también documentación y archivos sin seguimiento;
no use reset, checkout o limpieza para obtener un árbol artificialmente limpio.
Delimite el cambio y distinga estado persistido, sincronizado, derivado, local o
transitorio antes de ampliar un payload.

## Descubrimiento y codebase-memory

Cuando esté conectado, prefiera el MCP: compruebe raíz del checkout, worktree,
rama, HEAD, exclusiones y estado/frescura del índice. Use `search_graph` para
encontrar símbolos, `trace_path` para seguir callers/callees y
`get_code_snippet` para leer un símbolo identificado. `query_graph`,
`search_code` y `get_architecture` pueden ampliar el recorrido según el servidor
disponible. Consulte su esquema; no asuma una lista fija de herramientas.

Revise paginación y archivos excluidos. Un resultado ausente no prueba ausencia
de código. Corrobore los puntos importantes en las fuentes actuales: imports
dinámicos, closures, rutas, scripts y configuración pueden quedar incompletos.

Para literales, configuración, documentación o resultados insuficientes, use
`rg`/`rg --files`. Si una afirmación depende de una librería o SDK, resuelva su
versión en el lockfile y consulte Context7 o la documentación oficial de esa versión.

El script existente `npm run index:memory` invoca
`npx codebase-memory-mcp cli index_repository --repo-path . --mode fast` y puede
resolver una versión externa. Prefiera el MCP conectado cuando sea adecuado;
reindexe solo cuando haga falta y compruebe el resultado. No hay una medición
propia de ahorro de contexto ni prueba de cobertura completa del grafo o su visualizador.

## Recorridos de cambio

| Cambio | Recorrido mínimo y validación |
| --- | --- |
| Slide/edición | `src/types/presentation.ts` → `validation.ts`/`normalizePresentation.ts` → editor/SlideRow → PresenterScreen/SlideVisualizer → Audience |
| Control/menu | `src/components/control/`; MenuPopup coordina. Proyección emite intención; paneles y borradores permanecen locales |
| Renderizado | `src/components/presenter/` y render compartido en Audience; comprobar layout, texto, rangos y telemetría |
| Sincronización | `src/types/sync.ts` → validators/protocol → emisión en App/main-control → reducer/local-server/ws-server → useSyncState → consumidores |
| Timeline/audio | `src/types/audio.ts`, timelineManager, useAudioTimeline, audioTimeline y reproductores; preservar separación de volumen canónico/autoduck |
| Quiz | `src/types/quiz.ts`, quizUtils, hooks de timer/respuestas, reducer, validador servidor y UI Control/Audience; respetar frontera de agregados |
| Scripture | useSeferReader, metadataCache/scriptureLookup/parser, escritura del estado absoluto, reducer y SeferReaderScreen; distinguir menú manual y proyección |
| Voice Scripture | Parser/worklet/sesión/control de `src/features/voiceScripture/` → gateway → SCRIPTURE_PROJECT existente → snapshot confirmado |
| Live Audio | Tipos dedicados → validadores → WS/API LiveKit → hooks/contenedores de la feature → micrófonos y consumidores; núcleo sin imports estáticos del SDK |
| Import/export | `src/components/control/ImportExportPanel.tsx`, utilidades importadas y normalización/validación; conservar rechazo de datos inválidos |
| Catálogo público | Builder servidor, configuración de catálogos y UI `src/components/catalog/`; verificar contenido filtrado |
| Documento legal/PWA | Repositorio legal, Markdown compartido, DataProtectionPage, service worker y pwaUpdate; no servir una política obsoleta como vigente |

Los nombres concretos se comprueban en el checkout. Siga cada recorrido en ambos
sentidos; una prueba de un productor no valida todos los consumidores.

## Convenciones y modificación segura

- Los estilos usan Tailwind CSS 4 mediante `@tailwindcss/postcss`. El tema hebreo,
  las utilidades propias (`@utility`) y las fuentes escaneadas (`@source`) se
  mantienen en `src/index.css`; no hay un `tailwind.config.js` paralelo.
- Mantener coordinadores pequeños y lógica reusable en hooks/utilidades; no
  volver a concentrar comportamiento en App, MenuPopup o PresenterScreen.
- Componentes de proyección renderizan desde props. Si varias capas transportan
  los mismos campos, revisar la responsabilidad antes de ampliar prop-drilling.
- Las props públicas de hijos compartidos/extensos se declaran en sus interfaces;
  props estrechas locales pueden declararse junto al componente. Una prop requerida
  debe pasarse por todos los callers, no ocultarse con un valor por defecto que
  cambie comportamiento. Reservar defaults para datos realmente opcionales.
- Mantener controles accesibles, foco/labels y layout sin solapamiento; reutilizar
  primitives compartidos antes de duplicar texto autosizable o selectores.
- Reducir comandos soportados en backend; Presenter no debe volver a ser requisito
  para navegar desde Control hacia Audience.
- Validar fronteras externas/importadas y permisos servidor. No equiparar UUID,
  presencia, telemetría o Basic Auth con autoridad administrativa completa.
- Mantener Live Audio fuera de SyncStatePayload, RemoteCommandPayload,
  AudioState y AudioTimelineState; las señales privadas usan su contrato E2E.
- Mantener snapshots operacionales técnicos y agregados; alias, claves privadas,
  texto y respuestas individuales no pertenecen al snapshot servidor.
- Conservar asimetrías deliberadas: un Control secundario puede elegir fuente
  Voice, pero solo el principal transcribe; escucha local no implica captura.
- No sincronizar ticks frecuentes, drafts, paneles o scroll mediante snapshots
  completos. Cancelar hidratación/trabajo antiguo cuando cambia el contexto.
- Medios y corpus del operador viven fuera del producto; modificar avisos de
  terceros si cambian sonidos incluidos en `static/`.
- Mantener fallos de persistencia y concurrencia visibles. El borrador se conserva
  ante conflicto; no resolver un 412 reintentando silenciosamente otro overwrite.
- Los imports inválidos fallan de forma visible y los errores de exportación se
  informan. Normalizar solo después de validar; conservar el esquema compartido
  sin defaults silenciosos que conviertan entradas malformadas en válidas.
- Las preferencias de aviso/consentimiento de UI permanecen locales; no añadir
  registros de aceptación servidor como consecuencia incidental de un cambio.
- Reutilizar LegalMarkdown para política/primera capa, con HTML crudo e imágenes
  deshabilitados. El branding de bienvenida tiene otro renderer y admite imágenes.
  Una publicación legal existente es inmutable: correcciones crean secuencia nueva.
- En cambios PWA preservar scopes, network-first del shell y exclusión de
  endpoints vivos/documentos legales; update/reload no limpia datos de sesión.
- Para media iOS reutilizar mediaVolume/useSmoothVolume e IosAudioBufferPlayer;
  conservar unlock por gesto, recreación de fuentes one-shot y liberación de
  buffers. No cambiar una ruta de audio para arreglar otra sin comprobar ambos consumers.

## Corpus y comandos con efectos

`dev` no genera corpus. `prebuild` y `prebuild:web` sí ejecutan
[generate-verses](../../scripts/generate-verses.js): consideran el hash combinado
del corpus y aliases privados, y la ausencia de metadata/directorio de libros.
No verifican cada TSV existente. Un origen ausente produce aviso sin modificar datos.

`npm run deploy` optimiza medios, genera corpus y levanta Compose con un override
privado externo: no es un comando neutral de validación. Consulte
[operación](../operations/deployment.md) antes de usarlo.

## Tests y validaciones

Revise primero los scripts, hooks y configuración de pruebas. Seleccione checks
existentes que ejerciten el cambio, utilizando fixtures temporales cuando haya
persistencia. No ejecutar automáticamente los ejemplos operativos de la documentación.

```powershell
npx.cmd tsc -p tsconfig.app.json --noEmit
npx.cmd tsc -p tsconfig.node.json --noEmit
npm.cmd run test
npm.cmd run lint
```

En shells compatibles pueden usarse `npm`/`npx` sin `.cmd`. El tsconfig raíz
solo contiene referencias; un `tsc --noEmit` sin proyecto no comprueba los hijos.
La configuración no habilita strict ni type-check del backend `.mjs`.

El build completo incluye prehooks con escrituras de corpus. Ejecútelo en un
entorno de validación controlado, con datos autorizados y configuración explícita.
Pasar pruebas jsdom, mocks o builds no verifica SFU, navegador físico, GPU,
micrófono, reinicios o cambios reales de IP. Esas pruebas se registran por separado
en [preparación de release](../guides/prepare-release.md).

## Impacto documental

| Trigger | Fuente a revisar |
| --- | --- |
| Responsabilidades/límites/ownership | Arquitectura; nuevo ADR si hay decisión significativa |
| Payload, permiso, error, side effect o transporte | API HTTP/realtime y consumidores |
| Configuración/default/build-runtime/recuperación | Operación y guías dependientes |
| Comportamiento observable | Feature y how-to correspondiente |
| Almacenamiento, privacidad, cifrado o retención | Especificación, procedimientos y plantillas afectados |
| Propuesta implementada o descartada | TODO y referencia vigente; conservar evidencia histórica |
| Ruta/documento movido | Índice y enlaces entrantes; compatibilidad solo si existe necesidad real en una versión publicada |

Edite la referencia autoritativa, luego resúmenes y enlaces. No actualizar una
auditoría antigua para que parezca actual; documentar una comprobación posterior
por separado. No hay necesidad de un ADR para cada refactor.

## Cerrar el cambio

Revisar diff completo y `git status --short`; separar cambios propios y
preexistentes. Comprobar enlaces, rutas, ejemplos, afirmaciones y consumidores
afectados. Informar qué checks se ejecutaron y qué quedó sin verificar.
