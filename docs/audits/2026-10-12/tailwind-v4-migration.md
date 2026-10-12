# Migración de Tailwind 4 y revisión de dependencias — 2026-10-12

Base: `main@ef37315217efe78f06a615102ed899065f40d51d`. Preparación en
`codex/tailwind-v4`; este registro no acredita despliegue ni integración en main.

## Cambio preparado

Se ejecutó el migrador oficial `npx @tailwindcss/upgrade@4.3.3` desde un árbol
limpio. Tailwind y su plugin PostCSS quedan en 4.3.3. El tema hebreo y las
utilidades propias pasan a `src/index.css`; se elimina `tailwind.config.js` y
su referencia en el COPY del Dockerfile. Autoprefixer deja de ser necesario.
La detección de clases se limita explícitamente a `src` e `index.html`.

El migrador adapta clases en 47 archivos, incluyendo sombras, redondeados,
outline, blur, gradientes y valores numéricos. Se conserva el color de borde
por defecto de v3. No se modifican handlers ni contratos de aplicación.

Referencias oficiales: [migración](https://tailwindcss.com/docs/upgrade-guide),
[detección de clases](https://tailwindcss.com/docs/detecting-classes-in-source-files).
Requisitos de estilos: Safari 16.4+, Chrome 111+, Firefox 128+.

## Validación y límites

- TypeScript de app y node pasa; 73 archivos y 590 tests pasan.
- Build directo de Vite pasa con datos sintéticos y Live Audio/Voice desactivados;
  no se ejecuta el prebuild de corpus. Se conserva un build de v3 como referencia.
- Audit completo: cero vulnerabilidades, incluidas dependencias de desarrollo.
- Comparación en Chromium local: Control y Presenter a 1280×720; Control,
  Audience, índice y lector de catálogo a 390×844. Misma presentación sintética
  de dos slides, con hebreo, transliteración y texto latino. No se detectó
  desbordamiento horizontal del documento en las vistas móviles revisadas;
  la tabla de Control conserva su scroll horizontal interno.
- Capturas antes/después en `tmp/tailwind-*.png` (artefactos locales ignorados).
  Se conservan estructura y texto RTL. Hay diferencias menores de tonos y
  espaciado; Tailwind 4 también reconoce opacidades numéricas que v3 no generaba.
  No se afirma equivalencia de píxeles ni cobertura de todas las vistas/estados.
- No se ejecutaron Docker, despliegue, corpus del operador, aceptación en
  Safari/Firefox físicos ni SFU/audio. La suite con mocks no verifica dispositivos.
- Vite mantiene el aviso de `__dirname` para un futuro configLoader nativo;
  la versión actual compila correctamente. No se oculta ese aviso.

## Otras dependencias

Consulta de `npm outdated` y registro npm realizada el 2026-10-12. Las versiones
son una instantánea y no implican que cada actualización sea necesaria.

| Grupo | Versión instalada → disponible | Decisión |
| --- | --- | --- |
| @testing-library/react | 16.3.2 → 16.3.3 | Parche de desarrollo compatible, separado de la migración. |
| @types/ws | 8.18.1 → 8.18.2 | Parche de tipos compatible, separado de la migración. |
| @types/dompurify | 3.0.5, stub obsoleto | Retirar: DOMPurify ya publica sus propios tipos. |
| React / React DOM | 19.2.6 → 19.3.0 | Aplazar actualización de runtime a otro cambio con validación propia. |
| LiveKit client | 2.19.2 → 2.22.4 | Aplazar: necesita revisar changelog y verificar audio/dispositivos. |
| Framer Motion | 12.38.0 → 12.43.0; latest 14.1.0 | Aplazar; no mezclar cambios de animación con CSS. |
| Lucide / PapaParse / ws | 1.16.0 → 1.55.0 / 5.5.3 → 5.7.0 / 8.21.0 → 8.22.0 | Actualizaciones opcionales, sin vulnerabilidad detectada en el lockfile final. |
| TypeScript / Vitest / jsdom | 6.0.3 → 7.0.2 / 4.1.11 → 5.0.4 / 29.1.1 → 30.1.2 | Aplazar saltos mayores; los rangos actuales se conservan. |
| @types/node | 24.12.4 → 24.19.2; latest 26.6.5 | Conservar línea 24; no introducir tipos de Node 26 en un runtime 20/24. |
| @types/react y react-dom | 19.2.14 / 19.2.3 → 19.3.0 | Aplazar junto a revisión de React. |
| ESLint / typescript-eslint / globals / plugin-react | 10.4.0 → 10.12.0 / 8.59.3 → 8.71.2 / 17.6.0 → 17.13.0 / 6.0.2 → 6.1.2 | Aplazar cambios de toolchain que no corrigen vulnerabilidades del lockfile final. |
| eslint-plugin-react-refresh | 0.5.2 → 0.5.7 | Opcional; conservar para no ampliar las reglas de lint en este cambio. |
| Autoprefixer | 10.5.0 → 10.6.1 | Eliminar por la migración a Tailwind 4. |

El resto de dependencias directas no aparece como outdated en esta consulta.
No se añaden overrides ni se ejecuta `npm audit fix --force`.
