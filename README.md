# SeferPresenter

SeferPresenter es una aplicación React/Vite para proyectar presentaciones con soporte para diapositivas, fondos, video, audio sincronizado y navegación de textos sagrados. Está pensada para funcionar tanto en una pantalla de proyección como en una ventana de control, con una ruta de evolución clara hacia control remoto móvil.

## Modos de uso

- **Proyección**: abre la app sin parámetros. Muestra la diapositiva, fondo, video o lector de textos sagrados activo.
- **Control**: abre `?mode=control`. Permite seleccionar presentaciones, editar slides, cambiar fondos, controlar audio/video y navegar textos.
- **Editor de audio**: abre `?mode=audio-editor`. Permite asociar pistas de audio a presentaciones y cues de diapositiva.
- **Singlefile**: genera un HTML autocontenido para entornos sin servidor.

## Scripts

```bash
npm run dev        # servidor Vite en modo web
npm run build      # build web
npm run build:app  # build singlefile, genera dist/app_presenter.html
npm run test       # Vitest
npm run lint       # ESLint
npx tsc --noEmit   # verificación estricta de tipos
```

Los scripts `predev`, `prebuild` y `prebuild:app` regeneran `public/books/*.tsv` y `public/metadata.json` desde los datos bíblicos externos.

## Arquitectura

La aplicación se organiza por consumidor:

- `src/components/control/`: panel de operador y controles interactivos.
- `src/components/presenter/`: pantalla de proyección y lector visual.
- `src/components/shared/`: componentes comunes.
- `src/hooks/`: lógica de sincronización, navegación, fondos, audio, escritura y teclado.
- `src/types/`: contratos compartidos de presentación, audio, sincronización y transliteración.
- `src/utils/`: normalización, parsing, lookup bíblico, metadata y utilidades puras.

## Sincronización

La sincronización usa `BroadcastChannel` para pestañas locales y SSE/API para red local en modo web.

Canales principales:

- `SYNC_STATE`: navegación y estado completo necesario para inicialización.
- `AUDIO_TELEMETRY`: estado ligero de reproducción de audio.
- `VIDEO_TELEMETRY`: estado ligero de reproducción de video.
- `DISPLAY_TELEMETRY`: cambios de fondo, override y candado.

Esta separación evita reenviar el JSON completo de presentaciones durante ticks de reproducción o manipulación de fondos, algo importante para futuros controladores móviles.

## Estilos

Tailwind se usa como base, con clases repetitivas agrupadas en `src/index.css` dentro de `@layer components`.

Clases destacadas:

- `control-*`: botones, sliders, selects y paneles compactos del control remoto.
- `audio-*`: controles específicos del panel de audio.
- `glass-panel`, `glass-panel-nav`, `glass-panel-button`: superficies glassmorphism oscuras de la proyección.

La idea es mantener el JSX más legible y reducir cadenas largas repetidas, especialmente en elementos renderizados o mantenidos en pantalla durante sesiones largas.

## Tests

Hay una primera base de pruebas unitarias con Vitest:

- Normalización de presentaciones y hashes.
- Parsing/serialización de tags de escritura.
- Numerales bíblicos.

Los tests viven en `__tests__/` y se ejecutan con:

```bash
npm run test
```

## Verificación recomendada

Antes de cerrar cambios importantes:

```bash
npx tsc --noEmit
npm run test
npm run build
npm run build:app
npm run lint
```

`npm run lint` puede mostrar warnings de `react-hooks/exhaustive-deps`; los errores deben quedar en cero.

## Checklist manual

- Abrir proyección y control en ventanas separadas.
- Seleccionar una presentación y navegar slides.
- Probar fondos: override manual, candado, `Principal`, `Anterior`, `Ignorar`.
- Probar audio: pista, play/pause, volumen, seek y modos de sync.
- Probar video: play/pause, loop, velocidad, volumen y seek.
- Probar Sefer/Tanaj: proyectar, navegar versos, añadir slide.
- Probar `npm run build:app` abriendo `dist/app_presenter.html`.

## Notas de mantenimiento

- No editar datos generados en `public/books/` a mano; se regeneran desde `scripts/generate-verses.js`.
- Mantener telemetría de media/display en canales ligeros.
- Preferir utilidades compartidas en `src/utils/` antes de duplicar parsing o normalización.
- Mantener la pantalla de proyección liviana: sus paneles visuales deben apoyarse en clases compartidas como `glass-panel`.
