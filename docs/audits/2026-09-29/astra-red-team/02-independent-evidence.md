# Evidencia independiente y reproducibilidad

**29/09/2026 · 17:45**

## Entorno y aislamiento

Repositorio y dependencias locales del mismo snapshot `0623c7d9d1469404d0d138885df647e5c8064d45`; Node `24.15.0`, Vitest `4.1.8`. No se instalaron ni actualizaron paquetes. No se cargó `.env` del operador.

`harness/backend-review.mjs` crea un proceso hijo por escenario que ejecuta **server/local-server.mjs sin modificarlo**. `harness/backend-preload.mjs` fuerza escucha en `127.0.0.1` con puerto efímero, impide cargar env file, bloquea conexiones salientes del hijo y sustituye solo las operaciones administrativas finales de RoomServiceClient. Cada hijo recibe variables explícitas, claves ficticias, URL SFU `.invalid`, Voice Scripture desactivado y `SEFER_DATA_DIR` temporal propio. El padre solo conecta al puerto devuelto por IPC. Los datos de prueba se inicializan desde ejemplos del producto; no se inspecciona ni escribe contenido del operador.

El preload conserva callbacks de arranque. La consola del producto imprime `localhost:0` porque ve el valor configurado; la prueba utiliza el puerto efímero real comunicado por el servidor. El cierre normal de cada hijo registra SIGTERM del harness, no una caída del producto. H01-null, en cambio, termina espontáneamente con exit 1. Se conservan stdout/stderr y resultado de las aserciones por separado.

Los tests de UI usan React real, jsdom y almacenamiento sintético; sustituyen fetch, WS, SSE y BroadcastChannel. M02 conserva el componente padre del editor y observa props mediante un hijo visual mínimo. M04 usa estado/ref/setters reales y verifica DOM y localStorage. M06 usa el hook real y eventos sintéticos. Ningún test opera el navegador del usuario.

## Comandos

Desde la raíz del repositorio:

```powershell
node docs/audits/2026-09-29/astra-red-team/harness/backend-review.mjs
node docs/audits/2026-09-29/astra-red-team/harness/run-ui.mjs
```

El primer comando ejecuta los 18 escenarios backend actuales, cada uno en un hijo. También admite nombres concretos, por ejemplo `H03` o `M01-soft M01-hard M01-http`. Durante la revisión se ejecutaron primero H01×8/H02/H04/M03; después H03/M01×3/H02-controlled/M05; finalmente omissions-access. No se atribuye una ejecución única posterior del conjunto completo: todos sus escenarios sí tienen un resultado independiente satisfactorio retenido.

El wrapper UI ejecuta y conserva exactamente:

```powershell
node node_modules/vitest/vitest.mjs run --config docs/audits/2026-09-29/astra-red-team/harness/vitest.config.ts --configLoader runner --reporter=verbose
```

La configuración incluye exclusivamente el test nuevo y sitúa la caché en temporal. No ejecuta generador de corpus, build, dev, despliegue ni suite global. Los archivos JSON de evidencia contienen comando concreto, precondiciones, observación, stdout, stderr, exit y alcance. Los payloads completos reproducibles están en los harnesses.

## Inventario de resultados

| Evidencia bajo `evidence/` | Resultado independiente | Exit de aserción |
|---|---|---|
| H01-null.json | Frame null; backend exit 1; HTTP posterior no conecta | 0: reproduce defecto |
| H01-boolean.json | true; PONG posterior y HTTP 200 | 0 |
| H01-number.json | 1; PONG posterior y HTTP 200 | 0 |
| H01-string.json | cadena; PONG posterior y HTTP 200 | 0 |
| H01-array.json | []; PONG posterior y HTTP 200 | 0 |
| H01-object.json | {}; PONG posterior y HTTP 200 | 0 |
| H01-invalid.json | JSON malformado; PONG posterior y HTTP 200 | 0 |
| H01-valid.json | PING válido; PONG posterior y HTTP 200 | 0 |
| H02.json | Refresh inválido 403; status false→false, boolean true→true, GRANTED→true; JWT verificados | 0 |
| H02-controlled.json | Token sin admisión 403; admitido se autoconcede grant firmado | 0 |
| H03.json | Sin Basic, ID público autorizado alcanza tres llamadas SDK; matriz negativa funciona | 0 |
| H04.json | PENDING WS rechazado; command/state/display HTTP con Basic aplicados | 0 |
| M01-soft.json | Socket abierto pierde autoridad; nueva conexión recupera | 0 |
| M01-hard.json | Mismo resultado de servidor; flag hard difundido; reentrada recupera | 0 |
| M01-http.json | HTTP RESET no rota ID de sesión; WS antiguo sigue autorizado | 0 |
| M03.json | A0B0→A1B0→A0B1, dos 200; backup A1B0 | 0 |
| M05.json | GET nuevo, SSE operativo sin invalidación, copia vieja restaura cue | 0 |
| omissions-access.json | CONTROLLED: admisión, uso único, propósito y bloqueo de tickets funcionan | 0 |
| ui-results.json | 8 tests pasan: M04×2, M06×5, M02×1 | 0 |

Total: **18 escenarios backend y 8 tests UI**, con aserciones satisfechas. No son 26 vulnerabilidades ni 26 reparaciones.

## Intentos fallidos del propio harness

1. Primer arranque Node: `--import` recibió ruta Windows en vez de URL; exit 1 previo a cargar producto. Se corrigió con `pathToFileURL`. `runner-notes.md` conserva comando, stdout vacío, error y explicación.
2. Primera ejecución UI: 7 tests pasan y uno falla. Se había usado el cuarto argumento de `writeExpiringStorage` como TTL, cuando representa el reloj de creación: la supuesta referencia vigente estaba expirada. Se corrigió solo el setup del test. `ui-initial-harness-error.json` conserva salida completa y exit 1; `ui-results.json` conserva la ejecución corregida de ocho tests. No se cambió el código del hook para obtener verde.

## Evaluación de la evidencia anterior

| Prueba anterior | Qué sí demuestra | Debilidad / contraste nuevo |
|---|---|---|
| null-message Node | Excepción no controlada en callback WS y muerte del hijo | Servidor HTTP mínimo; la nueva prueba ejecuta backend completo y confirma caída HTTP |
| audience-self-grant | Payload de JWT cambia tras status/refresh | Invocación directa del API y decodificación sin verificación de firma; nueva prueba HTTP, firma verificada y CONTROLLED |
| forged-moderation | ID distribuido alcanza guard y método SDK | Request/response sintéticos y capa HTTP exterior ausente; nueva prueba retiene Basic/Origin y usa clave ECDH válida |
| reset-control | Vacía registro y rechaza socket viejo | Callback de autorización externo permisivo y sin lifecycle HTTP; nueva matriz separa soft/hard/HTTP y reentrada |
| Hook GET/SSE | Orden de setters y persistencia con una respuesta en vuelo | Refs recreadas y mayoría de setters no operativos; nueva prueba confirma rollback con React/DOM reales e incluye BC/deduplicación |
| Hook alias | Alias residual después de referencia expirada | Caso único; nueva matriz añade sesión vigente, logout, rotación y dos instancias |

Mockear el SDK de administración es apropiado para demostrar que se alcanza la frontera privilegiada sin operar un SFU. No invalida H03, pero limita su conclusión. Usar `createWsServer(..., () => true)` y llamar directamente al API no demuestra por sí solo todo el middleware del producto. La nueva suite elimina esa duda para H03/H04.

Los resultados anteriores de 486 tests, lint y TypeScript pertenecen a la primera auditoría. No se volvieron a ejecutar ni se presentan como validación nueva. Los dos archivos TypeScript vacíos son compatibles con éxito, pero aislados no retienen exit code; el informe anterior sí lo declara. Esto es una limitación de trazabilidad del artefacto, no prueba de un resultado falso.

## Conversión a regresión tras corregir

Conservar la matriz de forma WS, autoridad status→token, moderación vinculada al caller, equivalencia HTTP/WS, reset con siguiente operación, 500/red conservando borrador, dos revisiones de catálogo, orden GET/SSE/BC, invalidación tras commit y TTL/logout/rotación. Invertir las aserciones que hoy documentan el defecto: por ejemplo, H01 deberá seguir vivo y H02 deberá conservar `canPublish=false` sin concesión. Evitar fijar como contrato permanente los comportamientos defectuosos reproducidos aquí.

## Límites

No se midieron carga, memoria, latencia física ni disponibilidad del despliegue. No se ejercitó SFU real, audio, micrófono, TV, Bluetooth o Chromium. No se consultaron CVE ni documentación remota. Los casos de UI no sustituyen E2E entre dispositivos; los de backend sí pasan por las rutas reales y los validadores originales, con el aislamiento descrito.
