# Trazabilidad de commits, hallazgos y pruebas

| Commit | Fase / hallazgos | Verificación principal |
| --- | --- | --- |
| `13c82ae` | Exportación mediante Blob | Regresión de descarga, build |
| `eb5a894` | Autorización Control atómica, ACK/NACK | Pruebas WS/autorización |
| `386fbda` | `stateRevision`, snapshot, delta, gap y resync | Reducer y servidor multi-Control |
| `2af9a95` | Reanudación Control y overlay E2E | Snapshot/overlay/READY |
| `82db9a8` | Público/Controlado y Audience versionado | Acceso, tickets y reconexión |
| `a5055b0` | TTL y almacén offline protegido | PWA/admisión/limpieza |
| `fd0d25f` | Operador y `privacy.local.md` | Build/arranque/Markdown |
| `cdc1049` | `recordingEpoch` y confirmaciones | Políticas, rotación y micrófono |
| `b597b3a` | Semántica y anuncios Live Audio | Accesibilidad dirigida |
| `4f1bf16` | Restauración de foco | Transiciones remotas e inbox |
| `bec62f0` | B-03, SP-SRE-014/015 | Backups, permisos y fail-closed |
| `7e938c4` | B-01/02/05/07 | Quiz, privacidad y rotación |
| `bc7bd2c` | B-04/06, L-01/02 | Credenciales, cuotas y overlay |
| `b913ce4` | SP-PERF-006/007 | Assets hash y activación SW |
| `a433d3b` | SP-SRE-016/018 | ICE/TCP, API interna, readiness y Docker |
| `e6be288` | A11Y-FINAL-007 | Persistencia de foco y texto del alias durante rerenders |

En cada frontera se ejecutaron pruebas dirigidas, TypeScript y ESLint. Las
fronteras arquitectónicas incluyeron la suite completa y build. El resultado
acumulado final fue 49 archivos y 356 pruebas aprobadas.
