# Notas del runner

**29/09/2026 · 17:45**

El primer intento de `node docs/audits/2026-09-29/astra-red-team/harness/backend-review.mjs` terminó con exit code 1 antes de cargar el producto. stdout vacío; stderr: `ERR_UNSUPPORTED_ESM_URL_SCHEME: On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'`.

Causa: el argumento `--import` del preload se construyó como ruta Windows en vez de URL de archivo. Se corrigió exclusivamente el harness mediante `pathToFileURL`. El proceso y el directorio sintético se limpiaron. Este intento no aporta evidencia a favor ni en contra de ningún hallazgo del producto.
