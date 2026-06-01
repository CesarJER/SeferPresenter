# Auditoría Completa de SeferPresenter — Plan de Optimización y Mejora (v2)

## Resumen Ejecutivo

SeferPresenter es una aplicación React/Vite para proyección de presentaciones litúrgicas con soporte trilingüe (hebreo, transliteración, traducción), navegación de escrituras y sincronización audio/video entre múltiples dispositivos. La app funciona en dos modos: **web** (dev server con API backend) y **singlefile** (HTML autocontenido).

El proyecto es funcional pero presenta **deuda técnica severa** concentrada en dos archivos masivos y en la ausencia de separación de responsabilidades. Este plan detalla **26+ hallazgos** categorizados en 8 áreas, con propuestas concretas de refactorización.

**Decisiones confirmadas:**
- `ffmpeg-static` → usado por `make-pingpong.js` (mantener, mover a devDeps)
- `@emotion/is-prop-valid` → peer dependency opcional de `framer-motion` (mantener)
- `legacy/` → basurero local, no sincronizado con repo (no tocar)
- Testing → añadir Vitest
- Alcance → ejecutar **todas las fases**

---

## Hallazgos Críticos

### 🔴 1. God Components — Archivos Monolíticos

> [!CAUTION]
> Los dos archivos más grandes concentran casi toda la lógica de la aplicación y son un riesgo de mantenibilidad severo.

| Archivo | Líneas | Bytes | Problema |
|---------|--------|-------|----------|
| [MenuPopup.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/MenuPopup.tsx) | **3,794** | **190 KB** | Contiene editor de presentaciones, panel de control, selector de fondos, reproductor de audio, buscador, visor de slides, editor de escrituras, visor de video, configuración de fuentes... todo en un solo componente |
| [App.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx) | **1,810** | **73 KB** | Contiene TODA la lógica de sincronización (BroadcastChannel + SSE + localStorage), estado global, normalización, routing, playback de audio, telemetría, keyboard handling... |

**Impacto:** Cualquier cambio en una funcionalidad requiere editar archivos enormes. El riesgo de efectos secundarios es alto. Testing es prácticamente imposible.

#### Propuesta de Descomposición de App.tsx

| Nuevo Archivo | Responsabilidad | Líneas aprox. de App.tsx |
|---------------|-----------------|--------------------------|
| `[NEW] src/hooks/useSyncState.ts` | BroadcastChannel + SSE + `persistState` + `syncState` + `handleMessage` | L305-770 |
| `[NEW] src/hooks/useAudioPlayback.ts` | Audio load/play/pause/telemetry/sync cues (effects 1-5) | L1147-1375 |
| `[NEW] src/hooks/useScriptureNavigation.ts` | `buildScriptureSlideState`, `handleProjectScripture`, `handleSeferOnlineRef`, `handleAddScriptureSlide`, `handleScriptureBoundary` | L806-1554 |
| `[NEW] src/hooks/useKeyboardNavigation.ts` | Keyboard handler effect (arrows, escape) | L849-948 |
| `[NEW] src/hooks/useBackgroundResolver.ts` | `getActiveBackground`, lock/unlock, override logic | L950-1064 |
| `[NEW] src/hooks/useUrlSync.ts` | URL parsing, hash management, popstate/hashchange | L458-539 |
| `[NEW] src/utils/normalizePresentation.ts` | `normalizePresentation`, `normalizePublicPath`, `slugify`, `parseSlideHash`, `formatSlideHash` | L96-212 |
| `[NEW] src/types/presentation.ts` | Interfaces `Presentation`, `Slide`, `VideoState`, `ScriptureNavState`, `AppMode`, `SeferOnlineRefPayload` | L13-95 |

#### Propuesta de Descomposición de MenuPopup.tsx

Componentes extraídos a `src/components/control/` (ver sección de estructura):

| Nuevo Archivo | Responsabilidad |
|---------------|-----------------|
| `[NEW] PresentationEditor.tsx` | Editor visual de diapositivas (tabla + quick text) |
| `[NEW] PresentationList.tsx` | Lista de presentaciones con búsqueda |
| `[NEW] SlideRow.tsx` | Fila individual de diapositiva en tabla |
| `[NEW] AudioPanel.tsx` | Panel de audio con controles de reproducción y sync |
| `[NEW] BackgroundSelector.tsx` | Selector de fondos con preview |
| `[NEW] VideoControls.tsx` | Controles de video (play/pause/seek/volume/speed) |
| `[NEW] ImportExportPanel.tsx` | Import/Export JSON |
| `[NEW] ScriptureRangeEditor.tsx` | Editor de rango bíblico (ya existe inline) |
| `[NEW] CustomSearchSelect.tsx` | Custom dropdown (ya existe inline) |
| `[NEW] FormatLegend.tsx` | Leyenda de formato (ya existe inline) |

---

### 🔴 2. Duplicación de Código Masiva

> [!WARNING]
> Hay patrones de código repetidos entre 3-5 veces que deberían unificarse.

#### 2.1 Handling de mensajes BroadcastChannel duplicado

En [App.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx), las líneas **L586-701** contienen dos bloques casi idénticos de `handleMessage` (uno para presenter mode, otro para control mode). Ambos hacen lo mismo: comparar con `JSON.stringify`, setear states, llamar `persistState`. ~120 líneas repetidas.

**Fix:** Extraer un `applyRemoteState(data)` unificado usado por ambas ramas.

#### 2.2 SSE handler replica el mismo patrón

[App.tsx L705-770](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx#L705-L770) — El handler SSE repite la misma lógica de comparación y seteo de estados por tercera vez.

**Fix:** Misma función `applyRemoteState`.

#### 2.3 `syncState` llamado con 8-9 argumentos repetitivos

La función [syncState](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx#L325-L382) se invoca ~15 veces siempre pasando `currentPresentationRef.current, currentSlideIndexRef.current, backgroundLockRef.current, lockedBackgroundValueRef.current, userSelectedBackgroundRef.current, videoStateRef.current, appModeRef.current, scriptureStateRef.current`.

**Fix:** Crear un `getCurrentFullState()` que recopile todos los refs y hacer que `syncState` acepte un partial override: `syncState({ videoState: newState })`.

#### 2.4 `parseVerses` duplicado

- [useSeferReader.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferReader.ts#L47-L71) tiene su propia `parseVerses`.
- [scriptureParser.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/scriptureParser.ts#L22-L61) tiene otra `parseVerses` más completa (con DOMPurify).
- `sanitizeHtmlLight` en useSeferReader es un **no-op** (`return html`) mientras que la versión real está en scriptureParser.

**Fix:** Unificar en `scriptureParser.ts` y re-exportar. El hook debería importar de utils.

#### 2.5 `removeNiqqudFromPlainText` + `removeNiqqudPreserveHtml` duplicados

Presentes en ambos [useSeferReader.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferReader.ts#L34-L41) y [scriptureParser.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/scriptureParser.ts#L12-L19).

**Fix:** Centralizar en un módulo `utils/hebrewText.ts`.

#### 2.6 `SeferControlPanel` vs `SeferControlPanelMini` — Duplicación ~60%

[SeferControlPanel.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/SeferControlPanel.tsx) (380 líneas) y [SeferControlPanelMini.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/SeferControlPanelMini.tsx) (279 líneas) comparten:
- Misma lógica de `useSeferReader()`
- Mismos states de `hebrewFontSize` / `combinedTextBaseSize`  
- Mismos effects de restore y keyboard navigation
- Mismo slider drawer de ajuste de fuentes

**Fix:** Crear un hook `useSeferControlLogic()` que encapsule la lógica compartida y hacer que ambos componentes solo difieran en JSX.

#### 2.7 `metadata.json` se carga dos veces independientemente

- [useSeferReader.ts L151-163](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferReader.ts#L151-L163) carga `metadata.json` en cada instancia del hook.
- [SeferReaderScreen.tsx L36-44](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/SeferReaderScreen.tsx#L36-L44) carga `metadata.json` de nuevo.
- [scriptureLookup.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/scriptureLookup.ts#L47-L55) tiene su propio singleton de metadata.

**Fix:** Crear un singleton `MetadataCache` a nivel de módulo, reutilizado por todos los consumidores.

---

### 🟡 3. Rendimiento

#### 3.1 `JSON.stringify` usado como comparador de igualdad

En [App.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx), se usa `JSON.stringify(obj1) !== JSON.stringify(obj2)` como comparador en al menos **8 lugares** (L597, L612, L618, L621, L663, L678, L684, L687, L726-729, L1492). Esto es O(n) en cada mensaje de sincronización y para objetos `Presentation` pueden ser cientos de slides.

**Fix:** Implementar un campo `version` o `stateHash` numérico que se incremente en cada cambio, eliminando la necesidad de deep comparison. Alternativamente, comparación selectiva de campos clave (id, slideIndex).

#### 3.2 Telemetría de audio excesivamente agresiva

[App.tsx L1226-1259](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx#L1226-L1259) — La función `emitAudioTelemetry` llama a `syncState` que hace un `fetch('/api/state')` + `channel.postMessage` + `localStorage.setItem`. Todo esto ocurre cada 500ms durante la reproducción de audio, y `syncState` envía **todo el estado** (incluida toda la presentación con todas sus slides).

**Fix:** Crear un canal de telemetría separado y ligero que solo envíe `{ currentTime, isPlaying, volume }` sin el payload completo de presentación.

#### 3.3 Re-normalización innecesaria

`normalizePresentation()` se llama en cada `syncState`, cada `handleMessage`, cada `SSE event`. Aplicar idempotentemente la misma transformación decenas de veces por segundo es desperdicio.

**Fix:** Normalizar una sola vez al cargar/importar/guardar. Marcar con un flag `_normalized: true`.

#### 3.4 `loadedBooksRef` — Cache de libros no compartido

Cada instancia de `useSeferReader()` tiene su propio `loadedBooksRef`. Si hay un `SeferControlPanel` y un `SeferReaderScreen`, ambos descargan y parsean el mismo TSV.

**Fix:** Cache global a nivel de módulo (singleton) compartido entre todas las instancias.

---

### 🟡 4. Sistema de Tipos

#### 4.1 Abuso de `any`

| Archivo | Ubicación | Uso de `any` |
|---------|-----------|------------|
| [transliterate.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/transliterate.ts) | `config: any` en 7+ funciones | Debe ser una interface `TransliterationConfig` |
| [App.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx#L137) | `(slide as any).type` | Cast innecesario |
| [SeferReaderScreen.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/SeferReaderScreen.tsx#L11) | `onVerseSelected: (payload: any) => void` | Debería usar `SeferOnlineRefPayload` |
| [vite.config.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/vite.config.ts#L40) | `currentState: any` | Tipar el state del servidor |
| [PresenterScreen.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/PresenterScreen.tsx#L108) | `intervalId: any` | Usar `ReturnType<typeof setInterval>` |

**Fix:** Crear interfaces para `TransliterationConfig`, `SyncStatePayload`, `VersePayload` y reemplazar todos los `any`.

#### 4.2 Tipos definidos en el lugar incorrecto

Las interfaces `Presentation`, `Slide`, `VideoState`, `ScriptureNavState`, `AppMode` están definidas en [App.tsx](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.tsx#L13-L95) y exportadas desde ahí. Esto crea una dependencia circular implícita donde componentes hijos importan tipos del componente padre.

**Fix:** Mover a `src/types/presentation.ts`.

---

### 🟡 5. Sincronización de Estado

#### 5.1 Race conditions en sincronización bidireccional

El pattern actual envía **todo el estado** en cada sync. Si el controller y la projection envían al mismo tiempo (ej: el controller cambia slide mientras la projection emite telemetría de audio), el estado más reciente sobrescribe al anterior, potencialmente perdiendo cambios.

**Fix:** Separar los canales de sincronización:
- Canal 1: **Navigation** (presentation, slideIndex, appMode, scriptureState)
- Canal 2: **Media** (videoState, audioState) 
- Canal 3: **Display** (backgroundLock, lockedBackgroundValue, userSelectedBackground)

#### 5.2 `clientIdRef` — No hay manejo de conflictos

Si dos ventanas de control están abiertas simultáneamente, ambas pueden enviar comandos conflictivos sin mecanismo de resolución.

**Fix:** Implementar un pattern de "last-write-wins" con timestamps más granulares, o un lock advisory simple.

---

### 🟡 6. Dependencias y Configuración

#### 6.1 Dependencias mal clasificadas en `package.json`

En [package.json](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/package.json):

| Dependencia | Actualmente | Debería ser | Razón |
|-------------|-------------|-------------|-------|
| `@types/dompurify` | dependencies | devDependencies | Solo tipos TS |
| `@types/papaparse` | dependencies | devDependencies | Solo tipos TS |
| `autoprefixer` | dependencies | devDependencies | Herramienta de build |
| `postcss` | dependencies | devDependencies | Herramienta de build |
| `tailwindcss` | dependencies | devDependencies | Herramienta de build |
| `ffmpeg-static` | dependencies | devDependencies | Solo para `make-pingpong.js` (script de build) |
| `@emotion/is-prop-valid` | dependencies | ✅ correcto | Peer dep opcional de framer-motion, OK mantener |

#### 6.2 Nombre del paquete es `temp-app`

[package.json L2](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/package.json#L2): `"name": "temp-app"` → renombrar a `"sefer-presenter"`.

#### 6.3 App.css contiene estilos del template Vite no usados

[App.css](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/App.css) — 185 líneas de estilos del template original de Vite (`.hero`, `#center`, `#next-steps`, `#spacer`, `.ticks`). Ninguno se usa en la app actual.

**Fix:** Eliminar completamente App.css.

---

### 🟡 7. Seguridad

#### 7.1 `sanitizeHtmlLight` es un no-op

En [useSeferReader.ts L42-45](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferReader.ts#L42-L45):
```typescript
const sanitizeHtmlLight = (html: string): string => {
  return html; // ← PASS-THROUGH, no sanitiza nada
};
```
Se usa para producir `verseNikudSanitized` que luego se renderiza con `dangerouslySetInnerHTML`. DOMPurify está instalado pero no se usa aquí.

**Fix:** Importar `sanitizeHtml` de `scriptureParser.ts` y usarla.

#### 7.2 `dangerouslySetInnerHTML` sin sanitización en SeferControlPanel

[SeferControlPanel.tsx L349](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/SeferControlPanel.tsx#L349): usa `currentVerse.verseNikud` (sin sanitizar) en `dangerouslySetInnerHTML`.

**Fix:** Usar siempre `verseNikudSanitized`.

#### 7.3 Hack de compilador para silenciar warnings

[MenuPopup.tsx L650-652](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/MenuPopup.tsx#L650-L652):
```typescript
if (false as boolean) { console.log(onAudioSyncMapsChange); }
```

**Fix:** Prefixar con `_` o usar correctamente la prop.

---

### 🟢 8. Assets y Organización del Proyecto

#### 8.1 `presentations.json` en la raíz — 147 KB

[presentations.json](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/presentations.json) (147 KB) contiene datos de usuario. Se importa directamente en App.tsx para fallback singlefile.

**Fix:** Mover a `public/` o mantener un `defaultPresentations.json` reducido con datos de ejemplo.

#### 8.2 Scripts utility en la raíz

`generate-verses.js` y `make-pingpong.js` están en la raíz.

**Fix:** Mover a `scripts/`.

---

## Estructura Final — Componentes por Consumidor

La idea central: organizar `src/components/` en tres carpetas según quién los consume:

```
SeferPresenter/
├── scripts/                          # [MOVE] generate-verses.js, make-pingpong.js
│   ├── generate-verses.js
│   └── make-pingpong.js
│
├── src/
│   ├── types/                        # Tipos compartidos
│   │   ├── presentation.ts           # [NEW] Presentation, Slide, VideoState, ScriptureNavState, AppMode
│   │   ├── audio.ts                  # [KEEP] AudioState, AudioSyncMap, AudioSyncCue
│   │   ├── sync.ts                   # [NEW] SyncStatePayload, BroadcastMessage
│   │   └── transliteration.ts        # [NEW] TransliterationConfig
│   │
│   ├── hooks/                        # Lógica reutilizable
│   │   ├── useSyncState.ts           # [NEW] BroadcastChannel + SSE + persist + applyRemoteState
│   │   ├── useAudioPlayback.ts       # [NEW] Audio load/play/pause/telemetry/cue sync
│   │   ├── useScriptureNavigation.ts # [NEW] Scripture slide building + projection + boundary
│   │   ├── useKeyboardNavigation.ts  # [NEW] Keyboard handler (arrows, escape)
│   │   ├── useBackgroundResolver.ts  # [NEW] Background lock/unlock/override/resolve
│   │   ├── useUrlSync.ts             # [NEW] URL ↔ state sync
│   │   ├── useSeferReader.ts         # [MODIFY] Remove duplicated parseVerses, import from utils
│   │   ├── useSeferControlLogic.ts   # [NEW] Shared logic for Panel + PanelMini
│   │   ├── useResizablePanel.ts      # [KEEP]
│   │   └── scriptureNumerals.ts      # [KEEP]
│   │
│   ├── utils/                        # Funciones puras
│   │   ├── normalizePresentation.ts  # [NEW] normalize, slugify, parseHash, formatHash, publicPath
│   │   ├── hebrewText.ts             # [NEW] removeNiqqud*, sanitizeHtml (centralizados)
│   │   ├── metadataCache.ts          # [NEW] Singleton cache para metadata.json + books TSV
│   │   ├── scriptureLookup.ts        # [MODIFY] Usar metadataCache
│   │   ├── scriptureParser.ts        # [MODIFY] Absorber parseVerses central
│   │   └── transliterate.ts          # [MODIFY] Tipar config como TransliterationConfig
│   │
│   ├── components/
│   │   │
│   │   ├── control/                  # 🎛️ Solo usados por ?mode=control (panel de operador)
│   │   │   ├── MenuPopup.tsx         # [MODIFY] Orquestador reducido (~300 líneas)
│   │   │   ├── PresentationList.tsx  # [NEW] Lista de presentaciones con búsqueda
│   │   │   ├── PresentationEditor.tsx# [NEW] Editor tabla + quick text mode
│   │   │   ├── SlideRow.tsx          # [NEW] Fila individual de diapositiva
│   │   │   ├── AudioPanel.tsx        # [NEW] Controles de audio + sync mode
│   │   │   ├── BackgroundSelector.tsx# [NEW] Selector de fondos con lock
│   │   │   ├── VideoControls.tsx     # [NEW] Controls de video (play/seek/volume/speed)
│   │   │   ├── ImportExportPanel.tsx # [NEW] Import/export JSON
│   │   │   ├── ScriptureRangeEditor.tsx # [MOVE] Extraer de MenuPopup
│   │   │   ├── SeferControlPanel.tsx # [MODIFY] Usar useSeferControlLogic
│   │   │   └── SeferControlPanelMini.tsx # [MODIFY] Usar useSeferControlLogic
│   │   │
│   │   ├── presenter/               # 📺 Solo usados por la pantalla de proyección
│   │   │   ├── PresenterScreen.tsx   # [MOVE] desde components/
│   │   │   ├── SeferReaderScreen.tsx # [MOVE] desde components/
│   │   │   ├── SeferFlowView.tsx     # [MOVE] desde components/
│   │   │   └── VerseSidebar.tsx      # [MOVE] desde components/
│   │   │
│   │   ├── shared/                   # 🔗 Usados por control Y presenter
│   │   │   ├── AutoResizeText.tsx    # [MOVE] desde components/
│   │   │   ├── AutoResizeInput.tsx   # [NEW] Extraer de MenuPopup (AutoResizeInput + AutoResizeTextarea)
│   │   │   ├── CustomSearchSelect.tsx# [MOVE] Extraer de MenuPopup
│   │   │   ├── FormatLegend.tsx      # [MOVE] Extraer de MenuPopup
│   │   │   └── SlideVisualizer.tsx   # [MOVE] desde components/
│   │   │
│   │   └── AudioSyncEditor.tsx       # [KEEP] Se usa en modo ?mode=audio-editor (página aparte)
│   │
│   ├── App.tsx                       # [MODIFY] Orquestador reducido (~200-250 líneas)
│   ├── index.css                     # [KEEP]
│   ├── main.tsx                      # [KEEP]
│   └── vite-env.d.ts                # [KEEP]
│
├── __tests__/                        # [NEW] Tests con Vitest
│   ├── utils/
│   │   ├── normalizePresentation.test.ts
│   │   ├── hebrewText.test.ts
│   │   ├── scriptureParser.test.ts
│   │   ├── scriptureLookup.test.ts
│   │   └── transliterate.test.ts
│   └── hooks/
│       ├── useBackgroundResolver.test.ts
│       └── useSeferReader.test.ts
│
├── vite.config.ts                    # [MODIFY] Tipar currentState, limpiar
├── package.json                      # [MODIFY] Renombrar, reclasificar deps, añadir vitest
└── eslint.config.js                  # [KEEP]
```

### ¿Por qué esta estructura?

| Criterio | Beneficio |
|----------|-----------|
| **Claridad mental** | Al abrir `control/` sabes que solo afectas la ventana del operador |
| **Code splitting** | Futuro: lazy-load de `control/` evita que la pantalla de proyección cargue 190KB de editor |
| **Testing** | Tests de `presenter/` no necesitan mocks de estado de editor |
| **Onboarding** | Un nuevo desarrollador entiende inmediatamente qué componente va dónde |
| **Ownership** | Si se divide el trabajo, uno toca `control/` y otro toca `presenter/` sin conflictos |

---

## Proposed Changes — Por Fase

### Fase 1: Tipos, dependencias, limpieza de proyecto

> Bajo riesgo, alto valor organizativo. No cambia comportamiento.

#### [NEW] `src/types/presentation.ts`
Mover desde App.tsx: `Presentation`, `Slide`, `VideoState`, `ScriptureNavState`, `AppMode`, `SeferOnlineRefPayload`. Actualizar imports en todos los archivos que importan de `'../App'`.

#### [NEW] `src/types/sync.ts`
Definir `SyncStatePayload`, `BroadcastMessage` para tipar los mensajes del BroadcastChannel y SSE.

#### [NEW] `src/types/transliteration.ts`
Definir `TransliterationConfig` con campos `qereDivine`, `properNamesOnly`, `showForteMarker`, `forceInitialCapital`, `ayinMode`, `finalHeMode`, `qamatsQatanInference`.

#### [MODIFY] [package.json](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/package.json)
- Renombrar `"name"` a `"sefer-presenter"`
- Mover `@types/dompurify`, `@types/papaparse`, `autoprefixer`, `postcss`, `tailwindcss`, `ffmpeg-static` a devDependencies
- Añadir `vitest` + `@testing-library/react` a devDependencies
- Añadir script `"test": "vitest run"`, `"test:watch": "vitest"`

#### [DELETE] `src/App.css`
Eliminar — contiene solo estilos del template Vite no usados.

#### [MODIFY] `src/main.tsx`
Eliminar import de App.css si existe.

#### [MOVE] `generate-verses.js` → `scripts/generate-verses.js`
Actualizar path en `package.json` scripts (`predev`, `prebuild`, etc.)

#### [MOVE] `make-pingpong.js` → `scripts/make-pingpong.js`
Actualizar path en `package.json` script `"pingpong"`.

---

### Fase 2: Unificar helpers duplicados y fix de seguridad

> Elimina bugs de sanitización, reduce duplicación de código.

#### [NEW] `src/utils/hebrewText.ts`
Centralizar `removeNiqqudFromPlainText`, `removeNiqqudPreserveHtml`, `sanitizeHtml` (de DOMPurify).

#### [MODIFY] `src/utils/scriptureParser.ts`
Importar helpers de `hebrewText.ts`. Esta será la única `parseVerses` del proyecto.

#### [MODIFY] `src/hooks/useSeferReader.ts`
- Eliminar duplicados de `removeNiqqud*`, `sanitizeHtmlLight`, `parseVerses`
- Importar `parseVerses` de `utils/scriptureParser`
- Importar `sanitizeHtml` de `utils/hebrewText`

#### [NEW] `src/utils/metadataCache.ts`
Singleton que carga `metadata.json` una sola vez y cachea libros TSV. Usado por `useSeferReader`, `SeferReaderScreen`, `scriptureLookup`.

#### [MODIFY] `src/components/SeferControlPanel.tsx`
Cambiar `dangerouslySetInnerHTML={{ __html: currentVerse.verseNikud }}` → `currentVerse.verseNikudSanitized`.

---

### Fase 3: Extraer hooks de App.tsx

> Reduce App.tsx de 1810 → ~200-250 líneas. Riesgo medio, requiere testing cuidadoso de sincronización.

#### [NEW] `src/utils/normalizePresentation.ts`
Extraer: `normalizePresentation`, `normalizePublicPath`, `slugify`, `parseSlideHash`, `formatSlideHash`, `makeClientId`, `fallbackBackgrounds`.

#### [NEW] `src/hooks/useSyncState.ts`
Extraer: BroadcastChannel setup, SSE listener, `persistState`, `syncState`, `applyRemoteState` (unificado). Refactorizar para aceptar partial overrides en vez de 9 argumentos posicionales.

#### [NEW] `src/hooks/useBackgroundResolver.ts`
Extraer: `getActiveBackground`, `handleToggleBackgroundLock`, `handleSelectBackgroundOverride`, toda la lógica de resolución cascada (Ignorar/Principal/Anterior/custom).

#### [NEW] `src/hooks/useUrlSync.ts`
Extraer: `parseUrlAndSync`, popstate/hashchange listeners, URL update effect.

#### [NEW] `src/hooks/useKeyboardNavigation.ts`
Extraer: keyboard handler con toda la lógica de Escape (exit manual/scripture mode) y arrows (slide nav / verse nav).

#### [NEW] `src/hooks/useAudioPlayback.ts`
Extraer: los 5 useEffects de audio (load source, sync playback, telemetry emission, cue-driven navigation, bilateral seek).

#### [NEW] `src/hooks/useScriptureNavigation.ts`
Extraer: `buildScriptureSlideState`, `handleProjectScripture`, `handleSeferOnlineRef`, `handleAddScriptureSlide`, `handleScriptureBoundary`, `handleUpdateScriptureFontSizes`.

#### [MODIFY] `src/App.tsx`
Reducir a orquestador: importa hooks, compone el render condicional (control mode / audio editor mode / presenter mode). ~200-250 líneas.

---

### Fase 4: Descomponer MenuPopup.tsx

> Reduce MenuPopup de 3794 → ~300 líneas. Organiza componentes por consumidor.

#### Crear estructura de directorios
```
src/components/control/
src/components/presenter/
src/components/shared/
```

#### [MOVE] Componentes existentes a presenter/
- `PresenterScreen.tsx` → `presenter/PresenterScreen.tsx`
- `SeferReaderScreen.tsx` → `presenter/SeferReaderScreen.tsx`
- `SeferFlowView.tsx` → `presenter/SeferFlowView.tsx`
- `VerseSidebar.tsx` → `presenter/VerseSidebar.tsx`

#### [MOVE] Componentes existentes a shared/
- `AutoResizeText.tsx` → `shared/AutoResizeText.tsx`
- `SlideVisualizer.tsx` → `shared/SlideVisualizer.tsx`

#### [MOVE] Componentes existentes a control/
- `SeferControlPanel.tsx` → `control/SeferControlPanel.tsx`
- `SeferControlPanelMini.tsx` → `control/SeferControlPanelMini.tsx`

#### [NEW] Extraer de MenuPopup.tsx a archivos separados
- `ScriptureRangeEditor` (L79-246) → `control/ScriptureRangeEditor.tsx`
- `AutoResizeInput` + `AutoResizeTextarea` (L361-477) → `shared/AutoResizeInput.tsx`
- `CustomSearchSelect` (L479-606) → `shared/CustomSearchSelect.tsx`
- `FormatLegend` (L337-359) → `shared/FormatLegend.tsx`
- `PresentationList` (lista + búsqueda de presentaciones) → `control/PresentationList.tsx`
- `PresentationEditor` (editor tabla/quick de slides) → `control/PresentationEditor.tsx`
- `SlideRow` (fila individual de tabla) → `control/SlideRow.tsx`
- `AudioPanel` (controles de audio en control panel) → `control/AudioPanel.tsx`
- `BackgroundSelector` (selector de fondo con lock) → `control/BackgroundSelector.tsx`
- `VideoControls` (play/pause/seek/volume para video slides) → `control/VideoControls.tsx`
- `ImportExportPanel` (import/export JSON) → `control/ImportExportPanel.tsx`

#### [MODIFY] `src/components/control/MenuPopup.tsx`
Reducir a orquestador que compone los sub-componentes. ~300 líneas.

#### Actualizar todos los imports en App.tsx y otros consumidores

---

### Fase 5: Optimizar sincronización

> Mejora rendimiento en producción, especialmente con audio/video.

#### [MODIFY] `src/hooks/useSyncState.ts`
- Eliminar `JSON.stringify` comparisons → usar `version` counter o comparación de campos clave
- Separar canal de telemetría media (ligero) del canal de navegación (completo)
- Normalizar solo una vez al cargar, no en cada sync

#### [MODIFY] `src/hooks/useAudioPlayback.ts`
- Telemetría de audio envía solo `{ currentTime, isPlaying, volume, duration }` en un mensaje `AUDIO_TELEMETRY` separado, no el estado completo
- Reducir frecuencia de telemetry de 500ms a 1000ms para playback normal

#### [MODIFY] Eliminar re-normalización en handlers remotos
- `applyRemoteState` no debe llamar `normalizePresentation()` si los datos ya vienen normalizados

---

### Fase 6: Unificar SeferControlPanel / SeferControlPanelMini

#### [NEW] `src/hooks/useSeferControlLogic.ts`
Extraer lógica compartida:
- `useSeferReader()` wrapper
- Estados de font sizes con localStorage persist
- Restore effects
- Keyboard navigation handler
- `handleActivate`, `handleNext`, `handlePrev`, `handleAddSlide`

#### [MODIFY] `src/components/control/SeferControlPanel.tsx`
Solo JSX del panel completo, usando el hook.

#### [MODIFY] `src/components/control/SeferControlPanelMini.tsx`
Solo JSX del panel mini, usando el hook.

---

### Fase 7: Tipado fuerte

#### [MODIFY] `src/utils/transliterate.ts`
Reemplazar `config: any` con `TransliterationConfig` en todas las funciones: `classifyShevas`, `isLongVowelCluster`, `isQamatsQatan`, `mapCons`, `mapVowel`, `transliterateWord`, `transliterateText`.

#### [MODIFY] `src/components/presenter/SeferReaderScreen.tsx`
Cambiar `onVerseSelected: (payload: any) => void` a `onVerseSelected: (payload: SeferOnlineRefPayload) => void`.

#### [MODIFY] `src/vite.config.ts`
Tipar `currentState` con `SyncStatePayload`.

#### [MODIFY] varios archivos
Eliminar `(slide as any).type` cast en App.tsx y demás `any` residuales.

---

### Fase 8: Testing con Vitest + limpieza final

#### Setup de Vitest
- Configurar `vitest.config.ts` o sección `test` en `vite.config.ts`
- Añadir `@testing-library/react` y `jsdom` para tests de hooks

#### [NEW] Tests unitarios prioritarios

| Test | Archivo | Qué valida |
|------|---------|-----------|
| `normalizePresentation.test.ts` | `utils/normalizePresentation.ts` | Normalización correcta de paths, mode fallback, slide lines padding |
| `hebrewText.test.ts` | `utils/hebrewText.ts` | Remoción de niqqud, sanitización HTML |
| `scriptureParser.test.ts` | `utils/scriptureParser.ts` | Parsing de TSV, transformación de footnotes, sanitización |
| `transliterate.test.ts` | `utils/transliterate.ts` | Transliteración correcta de texto hebreo, proper nouns, divine name |
| `scriptureLookup.test.ts` | `utils/scriptureLookup.ts` | Parse de tags `[Sefer Gn 1:1-5]`, resolución de libros |
| `useBackgroundResolver.test.ts` | `hooks/useBackgroundResolver.ts` | Cascada de resolución (lock → override → verse bg → slide bg → Anterior → Principal) |
| `scriptureNumerals.test.ts` | `hooks/scriptureNumerals.ts` | Conversión de números a hebreo/griego |

#### Limpieza final
- Eliminar `src/App.css`
- Eliminar hack `if (false as boolean)` en MenuPopup
- Verificar que no quedan imports rotos
- Ejecutar `tsc --noEmit` sin errores
- Ejecutar `npm run build` y `npm run build:app` exitosamente

---

## Plan de Verificación

### Tests Automatizados
```bash
npm run test          # Vitest - todos los unit tests
npx tsc --noEmit      # Verificar tipos
npm run build         # Build web
npm run build:app     # Build singlefile
npm run lint          # ESLint
```

### Verificación Manual (checklist)
- [ ] Modo presentación: logo → click → abre control panel
- [ ] Modo control: lista presentaciones, buscar, seleccionar
- [ ] Editar presentación: tabla mode, quick text mode, guardar
- [ ] Navegación slides: arrows, click en lista
- [ ] Fondo: cambio por slide, lock/unlock, override manual, "Ignorar", "Anterior"
- [ ] Escrituras: proyectar Sefer, navegar versos, añadir slide
- [ ] Escrituras Tanaj: proyectar, backgrounds por verso
- [ ] Modo seferManual: abrir, navegar, Escape para volver
- [ ] Video slides: play/pause, volume, speed, loop, start/end times
- [ ] Audio sync: cargar track, play, unilateral sync, bilateral sync
- [ ] Sincronización: abrir 2 ventanas, verificar sync bidireccional
- [ ] Import/Export: exportar JSON, importar JSON
- [ ] Modo singlefile: `npm run build:app` → abrir `dist/app_presenter.html`
- [ ] Transliteración: generar transliteración desde editor hebreo

---

## Prioridad de Ejecución

| Fase | Cambios | Impacto | Riesgo |
|------|---------|---------|--------|
| **Fase 1** | Tipos, dependencias, limpieza de proyecto | Alto impacto organizativo | 🟢 Bajo |
| **Fase 2** | Unificar helpers, fix sanitización | Eliminar bugs + reducir duplicación | 🟢 Bajo |
| **Fase 3** | Extraer 7 hooks de App.tsx (1810→250 líneas) | Máximo impacto en mantenibilidad | 🟡 Medio |
| **Fase 4** | Descomponer MenuPopup en 11+ componentes por consumidor | Máximo impacto en mantenibilidad | 🟡 Medio |
| **Fase 5** | Optimizar sincronización y telemetría | Rendimiento en producción | 🟡 Medio |
| **Fase 6** | Unificar SeferControlPanel/Mini | Reducir duplicación | 🟢 Bajo |
| **Fase 7** | Tipado fuerte (eliminar `any`) | Seguridad de tipos | 🟢 Bajo |
| **Fase 8** | Vitest + tests + limpieza final | Calidad y confianza | 🟢 Bajo |

> [!IMPORTANT]
> **Estimación total:** Este refactoring completo es un trabajo significativo (~2-3 sesiones largas). Se recomienda ejecutar fase por fase, verificando después de cada una que la app sigue funcionando correctamente.
