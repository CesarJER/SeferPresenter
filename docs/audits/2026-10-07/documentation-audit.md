# Auditoría de documentación — 2026-10-07

## Evaluación

Había deriva material entre guías actuales: retención Docker, autoridad de
proyección, contratos HTTP, identidad Audience y cifrado. Las contradicciones
confirmadas se corrigieron en sus documentos canónicos y duplicados. Confianza
alta en esos hallazgos contra fuente/configuración; moderada en la suficiencia
global. No se certifica sincronización completa ni un despliegue real.

Metodología: `ai-codebase-documentation`, con estados VERIFIED, PARTIAL, STALE,
CONTRADICTED, UNVERIFIED y MISSING. P1 indica una suposición operativa o de
seguridad material; P2, fallo de integración/mantenimiento; P3, navegación o
detalle editorial. No se admitió ningún P0 documental con evidencia suficiente.

## Baseline y cobertura

- Checkout SeferPresenter, rama `main`, HEAD
  `57786c12dfb81a864a6f3eeaa7bc57e00a1091a2`; working tree inicialmente limpio.
- [Inventario por documento](coverage.md): 59 archivos de texto versionados,
  incluidos 24 actuales/plantillas/ejemplos y 35 históricos. La lectura cubrió
  esos archivos; verificación semántica de todos los comentarios y de todas las
  ramas de implementación: **PARTIAL**. No es una auditoría nueva de todo el software.
- Se trazaron HTTP/WS/reducer/SSE, snapshot Audience, privacidad/quiz, credenciales,
  catálogos/ETag, persistencia, sesión/TTL, crypto, voz opcional, PWA y generación.
  Docker/Compose/proxy, scripts y launcher se inspeccionaron sin operar servicios.
- El grafo inicial correspondía a otra rama/HEAD. Una reindexación fast sin
  persistencia devolvió 3865 nodos/8370 aristas y rama/raíz correctas, pero aún
  registraba HEAD `4fe65579db07842782c0468c8d8c2a384390699e`, distinto del checkout.
  Frescura: **UNVERIFIED**. Se usó para descubrir/trazar y se contrastaron las
  conclusiones importantes con archivos actuales. No se confundió grafo con prueba.

## Hallazgos documentales

Los estados de esta tabla describen el problema antes de corregirlo. Las acciones
cerradas significan corrección documental verificada estáticamente, con los
límites de ejecución indicados abajo.

| ID / prioridad / estado | Documento y afirmación | Evidencia concreta en el baseline | Impacto y acción |
| --- | --- | --- | --- |
| D01 — P1 — CONTRADICTED | Guía de operador §4/§12, política neutral «logs», CHANGE_GUIDE y comentario `.env.example`: tarea recrea contenedores y garantiza siete días. | `scripts/rotate-docker-logs.ps1` solo llama a Compose ps/inspect; edad del contenedor es umbral de aviso. Instalador usa trigger semanal. Compose app usa `local`, 5m × 3. | Operador puede prometer supresión no realizada o esperar mantenimiento que no existe. Corregidos todos esos duplicados; resultado 2 exige revisión. Borrado temporal **sin recrear contenedores**, pedido por el usuario, añadido a [TODO](../../../TODO.md), pendiente de viabilidad soportada. |
| D02 — P2 — CONTRADICTED/PARTIAL | Especificación de privacidad §6: HKDF, TLS incondicional y anti-replay servidor. | `cryptoUtils.deriveSharedKey`: ECDH P-256 → AES-GCM mediante deriveKey directo. `decryptWithNonceReplayProtection` opera en cliente. `ws-server.validatePrivateControlSignal` valida/ratea/enruta. | Modelo de seguridad incorrecto. Se describe la derivación real, límites del contexto de replay, TLS dependiente del despliegue y ausencia de autenticación independiente de claves frente al servidor. No se extiende E2E privado a audio SFU. |
| D03 — P2 — STALE/CONTRADICTED | ai-navigation, mapas, índice, ownership y diagramas: App detecta todos los modos, Presenter reduce comandos, servidor espejo; controles «propuestos». | `main-control.tsx`, `main-audience.tsx`, `App.tsx`; `local-server.reduceRemoteCommandMessage` → `reduceProjectionCommand` → commit/SSE. Módulos Live Audio ya existen. | Un mantenedor modifica el propietario equivocado o añade autoridad paralela. Corregidos entrypoints, reducer, diagramas y estado de módulos. Quitadas estimaciones de 500 KB/saturación sin medición. |
| D04 — P1 — CONTRADICTED/PARTIAL | CHANGE_GUIDE: alias solo en sesión de página; ownership: overlay cifrado servidor; mapa: alias dentro del perfil; TTL interpretado como borrado físico puntual. | `useAudienceSession`, `privacyStorage.readExpiringStorage`; `ws-server` perfil rechaza alias y snapshot permite campos técnicos. Alias viaja separado en `PRIVATE_CONTROL_SIGNAL`. | Expectativa falsa sobre retención en equipos compartidos y enrutamiento de datos sensibles. Reconciliados envoltura TTL/sesión, perfil técnico, snapshot sin overlay y límites de purga con navegador cerrado/suspendido. |
| D05 — P2 — CONTRADICTED | README modo catálogo: `SEFER_PUBLIC_CATALOG_TAGS`, proyección «segura» sin alcance. | `server/public-catalog-config.mjs` lee `SEFER_PUBLIC_CATALOGS_JSON`; `public-presentations-builder.mjs` filtra contenido. | Configuración copiada no habilita catálogo; recorte Audience no protege archivos/catálogos publicados por otras rutas. Corregida variable y alcance de publicación. |
| D06 — P2 — CONTRADICTED | README/guías: `tsc --noEmit` raíz como comprobación estricta. | `tsconfig.json` tiene files vacío y references; app/node no habilitan strict. Ejecución raíz con listFiles devuelve cero archivos. Lock usa TypeScript 6.0.3. | Falsa aprobación de tipos. Sustituido por checks explícitos de ambos proyectos; backend `.mjs` queda fuera. Advertidos prehooks build que pueden escribir corpus del operador. |
| D07 — P1 — MISSING/PARTIAL | Referencia actual omite prueba privada HTTP, caída WS, ETag/If-Match y revisión/epoch; fallback presentado sin su condición de autoridad. | `operatorAuth.getOperatorHeaders`, `ws-server.authorizeOperatorCredential`, guard de `local-server`, `requireCatalogRevision`, `catalogApi`, `useSyncState.acceptVersion`; tests HTTP/ordering. | Clientes viejos fallan con 403/428/412 o diseñan una concurrencia incompatible. Contratos añadidos a README, SYNC_ARCHITECTURE, diagramas y CHANGE_GUIDE; Basic no sustituye conexión autorizada. |
| D08 — P2 — PARTIAL | README: corpus cambia solo al cambiar TSV. | `generate-verses.createGenerationHash` incorpora aliases privados; regeneración también si faltan metadata/directorio books. No comprueba cada TSV. | Alias nuevo o salida incompleta se diagnostica mal; build no es un check documental inocuo. Corregidas condiciones y efectos del generador. |
| D09 — P1 — PARTIAL/CONTRADICTED | CHANGE_GUIDE prohibición absoluta de logs STT; privacidad general/plantilla no cubren excepción Voice. | `voice-scripture-server.debugLog`: eventos client/STT pueden contener texto y frases privadas bajo debug explícito. Gateway normal no persiste audio/texto. | Al habilitar diagnóstico puede retenerse contenido pese a la promesa absoluta. Añadidas excepción/configuración y revisión independiente del STT; mantener debug apagado normalmente. No se afirma fuga predeterminada. |
| D10 — P2 — PARTIAL | Voice/README omiten selección compartida, principal único y book-last; motor instalado presentado como hecho actual. | `LiveAudioControlContainer` usa VOICE_SOURCE_SELECTION y canTranscribe PRINCIPAL; parser soporta book-last; launcher valida 0.1.0. | Un secundario espera transcribir o se asume un motor actual no inspeccionado. Documentado reparto de roles y gramática; instalación/mediciones del piloto quedan históricas. |
| D11 — P2 — UNVERIFIED/STALE | CODEBASE_MEMORY: 90 % ahorro, herramientas fijas, trace entre dos símbolos y hook inexistente useAudioSync. | Esquema MCP efectivo; metadatos HEAD inconsistentes después de reindexar; símbolos actuales. | Confianza excesiva y consultas inválidas. Eliminadas métricas sin medición, explicado esquema/frescura/exclusiones; CLI y visualizador quedan sin validar. |
| D12 — P3 — STALE | Índice/ownership con enlaces file:/// de una máquina; privacidad cita public/audience-sw.js y server/persistence.mjs. | Rutas actuales `static/audience-sw.js`, `server/json-persistence.mjs`; verificación de destinos. | Navegación falla fuera del equipo original. Enlaces relativos y referencias corregidos. No se reescriben enlaces históricos a snapshots viejos. |
| D13 — P2 — PARTIAL | ASSET_OPTIMIZATION promete vídeo 720p para cualquier relación de aspecto. | `AssetOptimizer.optimize_videos` aplica `scale=1280:-2`; preset lleva nombre histórico 720p. | Operador espera altura fija que no se aplica a vertical/otras proporciones. Corregido ancho y altura proporcional; optimizador intacto. |
| D14 — P2 — PARTIAL/UNVERIFIED | Tabla de privacidad actual presenta checks históricos de runtime/Compose como estado vigente; históricos tienen referencias no recuperadas y salidas vacías. | Fases fechadas; `PRE_AUDIT_STABILIZATION` cita MULTI_CONTROL_SYNC_AUDIT.md ausente; typecheck-app/node.txt vacíos. Resolución 2026-10-05 distingue pre-fix/post-fix. | Una certificación pasada puede confundirse con verificación actual. Añadida atribución histórica en referencia actual. Registros conservados; no se deduce fracaso ni éxito de un fichero vacío. |
| D15 — P2 — PARTIAL | Marcador «frontera 24h», cleanup «garantizado», contribuciones «unlinkable» y umbral como anonimato absoluto. | `presentation-session.readMarker` comprueba caducidad al iniciar; getSessionId no comprueba reloj. Cleanup WS usa timers; IDs por ámbito no eliminan correlación externa. | Retención/anonimato se sobreinterpreta. Aclarados plazos y alcance; comentario de quiz acotado y advertencia técnica de correlación. |
| D16 — P3 — STALE | JSDoc QuizSlideEditor: autosave durable por blur; useQuizTimer remite a useRemainingMs inexistente; envío de detalle al Control. | Editor propaga onChange; persistencia de catálogo pertenece al padre. Timer devuelve getRemainingMs. Quiz envía agregados. | Lectura incorrecta de contratos locales. Corregidos solo comentarios; AST ejecutable idéntico confirmado. |
| D17 — P2 — UNVERIFIED | THIRD_PARTY_NOTICES atribuye archivos a Pixabay/generación propia sin fuente original individual verificable. | Aviso versionado y licencia primaria consultada; no identifica páginas de descarga/autor por sonido. | No permite certificar procedencia/licencia de cada archivo. Aviso preservado; recomendación: recuperar evidencia de adquisición, sin inventar autores o URLs. |

## Cambios y preservación

Correcciones en README, diez guías de navegación/arquitectura/voz/optimización,
guía/especificación/plantilla de privacidad y política neutral. Tres archivos
fuente tienen únicamente comentarios modificados; `.env.example`, únicamente
un comentario. Nuevos: este informe, coverage.md y TODO.md. No hay movimiento de
documentos, nueva arquitectura, dependencia, cambio funcional ni commit/push.

Los 64 archivos históricos permanecen sin cambios frente a HEAD; se preservan
auditorías, harnesses, evidencias y plan de audio sin implementar. Los 21 JSON
históricos parsean. Las evidencias pre-fix no se ejecutaron de nuevo ni se
sobrescribieron. No se inspeccionaron secretos, registros reales o datos privados.

## Observaciones de implementación, sin corrección

- I01 — PARTIAL: el marcador persistido caduca al cargar, pero una sesión que
  permanece en RAM no rota por el reloj de ese archivo. Confirmado en
  `createPresentationSessionStore.getSessionId` y sus consumidores. Es una
  decisión/posible gap si se pretende TTL duro del servidor; no invalida por sí
  sola el TTL local Audience. Falta acordar ese requisito y probar reloj avanzado.
- I02 — STALE potencial: `scripts/make-pingpong.js` busca
  `scripts/public/backgrounds`, no `SEFER_DATA_DIR/public/backgrounds`. Su npm
  script existe, pero no se presenta como flujo soportado en las instrucciones
  de uso actuales. Antes de reutilizarlo, revisar intención/ruta con fixtures.
  No se ejecutó FFmpeg ni se cambió el script.
- I03 — MISSING como funcionalidad solicitada: auditoría Docker no implementa
  borrado por edad. [TODO](../../../TODO.md) registra preferencia del usuario,
  condiciones de seguridad y aceptación sin recreación/reinicio. No es un
  defecto probado del driver ni se ha implementado borrado en esta tarea.

## Validación ejecutada

| Check | Resultado y alcance |
| --- | --- |
| Identidad Git/status inicial y final | Rama/HEAD conservados; inicial limpio, final contiene solo cambios de esta auditoría. |
| `node node_modules/typescript/bin/tsc --noEmit --listFiles` | Exit 0, cero archivos: confirma insuficiencia del comando raíz. |
| `node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit` | Pasa. No ejecuta generador. |
| `node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit` | Pasa. Configuración Vite, no backend. |
| Vitest local, ocho suites con `--maxWorkers=2` | 32/32 pasan: cryptoUtils, pwa, privacyLogAudit, useSyncStateOrdering, useAudienceSession, auditRemediationHttp, presentationSessionHttp, voiceSourceSelection. |
| `scripts/test-docker-log-audit.ps1` | Pasa, Docker totalmente mockeado: límites, avisos, servicios override y ausencia de mutaciones. |
| Impresión AST TypeScript con removeComments antes/después | Idéntica en los tres archivos fuente modificados. |
| Comparación de valores `.env.example` excluyendo comentarios | Idénticos. |
| JSON históricos y diff de historia | 21 válidos; ninguna modificación de las 64 piezas históricas. |
| `git diff --check` e inspección del diff | Sin errores de whitespace; cambios documentales y comentarios revisados. |
| Destinos locales y fences de 26 Markdown actuales, incluidos los nuevos | 118 enlaces y 584 referencias literales comprobados, sin destinos ausentes; fences equilibrados. Referencias históricas no recuperadas conservadas como límites. |
| Revisión de privacidad del diff | Sin secretos/datos reales añadidos; enlaces locales de máquina sustituidos por relativos en guías actuales. |

Las pruebas HTTP levantan procesos aislados en puertos de loopback temporales con
datos sintéticos y voz deshabilitada. Las de UI/red usan mocks; no prueban SFU,
dispositivos ni navegador físico. No se ejecutó suite completa, lint global,
build, corpus, optimización, deploy, instalador de tareas, Docker real, smoke STT
ni scripts históricos. Los diagramas Mermaid se revisaron contra el flujo actual;
no se ejecutó un renderizador para verificar su presentación. Esos comandos no son necesarios para un cambio documental
y algunos escriben datos, conectan a servicios o modifican infraestructura.

## Dependencias, fuentes externas y límites

Versiones del lock: TypeScript 6.0.3, Vite 8.0.13, Vitest 4.1.8, React 19.2.6,
LiveKit cliente 2.19.2 / server SDK 2.19.1; imagen declarada LiveKit 1.13.1.
Versiones efectivamente desplegadas: UNVERIFIED. Context7 consultado después de
resolver bibliotecas. Su resultado TypeScript versionado no dio evidencia
adecuada para 6.0.3; se recurrió a configuración/compilador locales y
[referencia primaria de proyectos](https://www.typescriptlang.org/docs/handbook/project-references.html).

[Docker local](https://docs.docker.com/engine/logging/drivers/local/) y
[json-file](https://docs.docker.com/engine/logging/drivers/json-file/) documentan
rotación por tamaño y advierten contra manipular archivos internos con herramientas
externas. Esa evidencia no establece una función soportada de borrado por edad
sin recreación. [LiveKit encryption](https://docs.livekit.io/transport/encryption/)
distingue transporte de cifrado extremo a extremo;
[Pixabay Content License](https://pixabay.com/service/license-summary/) no prueba
la procedencia de los tres sonidos concretos.

No se verificaron servicios actuales, Docker Desktop/driver efectivo, firewall,
TLS, NAT/ICE/UDP, reinicios, restauración de volúmenes, carga/latencia, dispositivos,
retención efectiva del STT ni publicaciones privadas. Las guías legales generales
no se recertifican jurídicamente y necesitan evaluación del operador. Tampoco se
certifica cada JSDoc/comentario inline o condición de todas las funciones. El
inventario es completo; la verificación semántica integral sigue siendo parcial
en las zonas explícitas de coverage.md. Las guías corregidas son una referencia
más fiel a la fuente, no una certificación de funcionamiento o privacidad absoluta.
