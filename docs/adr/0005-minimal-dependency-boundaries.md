# 0005 — Límites mínimos de dependencias

Estado: Proposed. Los controles están implementados; el registro queda propuesto
para revisión y aceptación formal.
Fecha: 2026-10-21.

## Contexto

La separación de tipos y widgets Scripture establece un ejemplo de composición,
sin imponer el mismo controlador o store a todas las capacidades. Los contratos
portables deben poder evolucionar sin importar hooks, UI o SDK de infraestructura.
El backend conserva la autoridad sobre proyección, permisos y estado sincronizado.

La configuración existente tiene ESLint, TypeScript y Vitest. Las restricciones
estáticas de imports por sí solas no cubren `import()` y expresiones de tipo
`import(...)`. Además, `types/liveAudio.ts` mezcla mensajes portables con dos
interfaces locales del navegador. Una prohibición general de todos los hooks o
de todos los tipos de ese archivo produciría falsos positivos.

## Decisión propuesta

- Añadir una sola regla local de ESLint, con tres comprobaciones y sin opciones
  de configuración: dependencias de contratos, propiedad del controlador Scripture
  e importadores permitidos de los dos SDK LiveKit.
- Aplicarla a archivos JS/JSX/TS/TSX/MJS/CJS/MTS/CTS de `src/` y a archivos
  JS/TS/MJS/CJS/MTS/CTS de `server/`. No activar las reglas generales de frontend
  sobre todo el backend. Tests y scripts de desarrollo no pertenecen a ese scope.
- Permitir en `src/types/` solo imports y reexports hacia otros módulos dentro de
  la misma carpeta, resolviendo rutas relativas normalizadas. Prohibir allí cargas
  de runtime con `import()` y `require()`, incluso con argumentos calculados.
- Prohibir que `SeferControlPanel.tsx` y `SeferControlPanelMini.tsx` importen el
  lector o importen como valor el controlador. Permitir imports de tipos desde
  `useSeferControlLogic`; mantener hooks visuales y reutilización de vistas.
- Confinar `livekit-client` a `src/features/liveAudio/hooks/useLiveAudio.ts`, y
  `livekit-server-sdk` a `server/livekit-server.mjs`, propietarios actuales.
  El permiso de un SDK no concede acceso al otro.
- Cubrir imports, namespaces, reexports nombrados y `export *`, `import()` literal,
  templates sin sustituciones, `import type`, expresiones de tipo `import(...)`,
  `import = require(...)` y llamadas directas `require(...)`.
- Compilar recursivamente los contratos con ES2023, sin DOM ni paquetes de tipos
  ambientales automáticos, sin emitir archivos y comprobando también módulos JS.
  Rechazar referencias que incorporen las librerías DOM/WebWorker al programa.
  Mantener `strict` como en el proyecto; no cambiar las configuraciones app/Node.
- Ejecutar estas comprobaciones mediante `npm run lint` y `npm test`, incluyendo
  lint en el workflow existente.

### Excepciones exactas de portabilidad

Todas corresponden a `src/types/liveAudio.ts`, diagnóstico TypeScript 2304:

| Interfaz local | Miembro | Tipo del navegador |
| --- | --- | --- |
| `LiveAudioMicrophoneDiagnostics` | `permissionState` | `PermissionState` |
| `LiveAudioRemoteTrack` | `track` | `MediaStreamTrack` |
| `LiveAudioRemoteTrack` | `attach` | `HTMLMediaElement` |
| `LiveAudioRemoteTrack` | `detach` | `HTMLMediaElement` |

Cada excepción se consume una sola vez. No se admite un presupuesto numérico de
errores ni se excluye todo el archivo. Un miembro o tipo distinto, una segunda
ocurrencia, otro diagnóstico o una excepción ya innecesaria falla el test.
Estas interfaces no son DTOs de red. Su eventual traslado requiere otro cambio
revisado; aquí no se modifican definiciones ni payloads.

## Consecuencias y límites

No se añaden dependencias, registros de módulos, stores globales, generación de
schemas ni un framework arquitectónico. Los controles solo afectan al desarrollo
y CI; no cambian el bundle del producto, el protocolo ni el comportamiento UI/RTC.

La regla local se justifica por los imports dinámicos/de tipos y la normalización
de rutas que una restricción estática de imports no cubre. No resuelve aliases de
TypeScript, symlinks ni todo el grafo transitivo. Las cargas con valores calculados
fuera de contratos y los loaders indirectos necesitan revisión. Un barrel de una
capacidad con runtime no debe convertirse en entrada global para código portable.

Compilar sin DOM no demuestra serialización JSON, compatibilidad con un cliente
nativo ni autorización. Mantener validadores y pruebas de protocolo. Cambios de
TypeScript que alteren diagnósticos requieren revisar las excepciones, no ampliar
una exclusión genérica.

Son criterios de revisión y pruebas de comportamiento: propietario estable por
contexto funcional; cleanup simétrico de listeners, suscripciones, temporizadores
y sesiones; cancelación o descarte de async obsoleto; recursos activos correctos
bajo StrictMode; widgets simultáneos sin comandos duplicados; preservación de
estado al moverlos; políticas manual/proyectada; autoridad y privacidad servidor.
No se exige un controlador o store por capacidad.

Mantener estado visual local, Tailwind 4 y utilidades existentes. Incorporar
tokens semánticos cuando exista una necesidad compartida; no migrar todos los
estilos. Conservar i18n, dirección del contenido hebreo, interacción por teclado,
accesibilidad y comportamiento responsive. No se añade un motor de layouts.

## Evidencia y relaciones

- [Regla de imports](../../scripts/eslint-architecture.mjs).
- [Configuración ESLint](../../eslint.config.js).
- [Tests de arquitectura](../../__tests__/architectureBoundaries.test.ts).
- [Tests de composición Scripture](../../__tests__/scriptureControlComposition.test.tsx).
- [Workflow](../../.github/workflows/verify-code.yml).
- [Arquitectura](../architecture/overview.md) y [desarrollo](../development/guide.md).
- [ADR 0001](0001-server-projection-authority.md), [0003](0003-active-connection-authority.md)
  y [0004](0004-snapshot-ordering.md) conservan sus decisiones y registros históricos.

La deuda de `AppMetadata`, el ciclo de `BroadcastChannel` y refactors de
Participation/Messaging/RTC quedan fuera de este cambio.
