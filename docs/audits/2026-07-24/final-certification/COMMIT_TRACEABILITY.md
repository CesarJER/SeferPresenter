# Trazabilidad de commits, hallazgos y pruebas

| Commit | Fase / hallazgos | Verificación principal |
| --- | --- | --- |
| `765fa3b` | Exportación mediante Blob | Regresión de descarga, build |
| `c754e68` | Autorización Control atómica, ACK/NACK | Pruebas WS/autorización |
| `9bf32f0` | `stateRevision`, snapshot, delta, gap y resync | Reducer y servidor multi-Control |
| `ca99342` | Reanudación Control y overlay E2E | Snapshot/overlay/READY |
| `26c3bf4` | Público/Controlado y Audience versionado | Acceso, tickets y reconexión |
| `57bc681` | TTL y almacén offline protegido | PWA/admisión/limpieza |
| `e07b462` | Operador y `privacy.local.md` | Build/arranque/Markdown |
| `e8da9e3` | `recordingEpoch` y confirmaciones | Políticas, rotación y micrófono |
| `d449dfc` | Semántica y anuncios Live Audio | Accesibilidad dirigida |
| `cccb634` | Restauración de foco | Transiciones remotas e inbox |
| `7ba39d8` | B-03, SP-SRE-014/015 | Backups, permisos y fail-closed |
| `29a7c43` | B-01/02/05/07 | Quiz, privacidad y rotación |
| `3adb91d` | B-04/06, L-01/02 | Credenciales, cuotas y overlay |
| `d5fe035` | SP-PERF-006/007 | Assets hash y activación SW |
| `113ad32` | SP-SRE-016/018 | ICE/TCP, API interna, readiness y Docker |
| `c14e157` | A11Y-FINAL-007 | Persistencia de foco y texto del alias durante rerenders |

En cada frontera se ejecutaron pruebas dirigidas, TypeScript y ESLint. Las
fronteras arquitectónicas incluyeron la suite completa y build. El resultado
acumulado final fue 49 archivos y 356 pruebas aprobadas.
