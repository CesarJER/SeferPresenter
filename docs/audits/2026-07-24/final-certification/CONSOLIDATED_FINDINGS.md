# Registro consolidado de hallazgos

## Criterio

- **S0:** compromiso o pérdida crítica inmediata.
- **S1:** bloquea producción del perfil afectado.
- **S2:** riesgo relevante mitigable o evidencia obligatoria pendiente.
- **S3:** mejora no bloqueante.

La auditoría coordinada cubrió arquitectura, autorización, privacidad,
sincronización multi-Control, Live Audio, PWA/offline, persistencia, Docker,
rendimiento y accesibilidad. No se detectaron S0.

## Hallazgos cerrados

| ID | Sev. | Hallazgo | Corrección y evidencia |
| --- | --- | --- | --- |
| B-01 | S1 | SSE de Quiz no distinguía Control autenticado y ticket Audience en `CONTROLLED`. | Clasificación explícita y pruebas de autorización; `29a7c43`. |
| B-02 | S1 | Estado nominal de Quiz podía sobrevivir una rotación. | Purga total ligada a sesión; `29a7c43`. |
| B-03 / SP-SRE-015 | S1 | Recuperación de backups incompleta o insegura. | Validación, restauración automática y fallo cerrado; `7ba39d8`. |
| B-04 | S1 | Bootstrap Audience público sin límites y con revisiones artificiales. | Capacidad, rate limit, índice por huella y revisión solo para estado visible; `3adb91d`. |
| B-05 | S2 | Identidad de Quiz podía separarse de la credencial admitida. | Identificador técnico derivado de la admisión; `29a7c43`. |
| B-06 | S2 | Timeline podía alcanzar conexiones Audience no vinculadas. | Credencial servidor obligatoria y filtrado de broadcasts; `3adb91d`. |
| B-07 | S2 | Texto de privacidad describía datos no tratados. | Hechos técnicos y narrativa del operador separados; `29a7c43`. |
| L-01 | S1 | En `PUBLIC` una conexión no vinculada podía crear identidades o recibir señales. | Prueba de posesión también en Público; `3adb91d`. |
| L-02 | S2 | Un overlay futuro podía envenenar la revisión privada. | Validación de base técnica, huecos y deduplicación; `3adb91d`. |
| SP-SRE-014 | S1 | El volumen de backups no era escribible por el usuario runtime. | Preparación privilegiada y descenso a `node`; `7ba39d8`. |
| SP-PERF-006 | S2 | El precache no incluía todos los assets hash del build. | Worker generado desde el grafo real de Vite; `d5fe035`. |
| SP-PERF-007 | S2 | Activación automática del Service Worker podía interrumpir sesiones. | Activación coordinada por la acción de reinicio; `d5fe035`. |
| SP-SRE-018 | S2 | Readiness Live Audio comprobaba configuración, no LiveKit. | RoomService acotado, API interna y 503 real; `113ad32`. |
| A11Y-FINAL-001..006 | S2 | Anuncios cerrados, bloqueo, foco remoto, nombres de acciones y errores no eran plenamente operables. | Regiones vivas neutrales, nombres únicos y restauración de foco; `d449dfc`, `cccb634`. |
| A11Y-FINAL-007 | S1 | Las actualizaciones en vivo reiniciaban el ciclo de foco del diálogo y expulsaban el cursor mientras se escribía el alias. | Ciclo de foco estable durante toda la apertura y regresión de rerender; `c14e157`. |
| SP-PRIV-005/007 | S2 | El flujo de audiencia omitía validación completa de consentimiento y perfil tras ciertas limpiezas. | Restauración estricta de perfil y consentimiento; `a5e6263`. |
| SP-PRIV-008 | S3 | Falta de claridad y recordatorio de grabación para la audiencia. | Cuadros de diálogo y textos actualizados; `a33d530`. |
| A11Y-FINAL-008 | S2 | Páginas de acceso y privacidad quedaban cortadas sin scroll vertical en dispositivos pequeños. | Estilos de scroll habilitados; `764ece6`. |
| B-08 | S2 | Las peticiones de palabra no se verificaban completamente contra la credencial de sesión en vivo. | Binding enrutado a credenciales; `0091ceb`. |
| MC-SYNC-008 | S2 | El cliente enviaba `REVOKED` de forma prematura cancelando sus propias peticiones (mitigación). | Condiciones de guardia en estado pendiente; `d76f49e`. |
| MC-SYNC-002 | S2 | Permisos de vista de lista activa se perdían al recargar la sesión. | Persistencia en memoria y resincronización al vincular; `59ecd9c`. |
| SP-PRIV-001 | S1 | El uso de `sessionStorage` era frágil en móviles, perdiendo sesión de Quiz y Panel de Audio. | Migración segura a `localStorage`; `a876409`. |

## Hallazgos residuales

| ID | Sev. | Estado | Impacto y cierre requerido |
| --- | --- | --- | --- |
| EXT-A11Y-001 | S2 | Evidencia externa pendiente | Ejecutar dos pasadas con NVDA/Windows 11, VoiceOver/iPhone y TalkBack/Android. Cualquier fallo WCAG 2.2 A/AA reabre el perfil afectado. |
| EXT-LIVE-001 | S1 Live Audio | Abierto | Validar desde datos móviles reales, con UDP disponible y bloqueado, reconexión y cambio DDNS. Hasta entonces Live Audio permanece `NO-GO`. |
| SP-SRE-016 | S1→S2 mitigado | Parcial | ICE/TCP 7881 ya existe. TURN/TLS no está incluido porque necesita dominio y certificado del operador; los despliegues que lo necesiten deben configurarlo y probarlo. |
| SP-SRE-017 | S2 | Aceptado/documentado | El descubrimiento de IP ocurre al arrancar LiveKit. Tras cambiar DDNS/IP pública hay que reiniciar el servicio, sin reconstruir la imagen. |
| EXT-LOAD-001 | S2 | Evidencia externa pendiente | Ejecutar tres Controles y 50 Audience, incluyendo pérdida, duplicación y reorden de red. |
| EXT-SUPPLY-001 | S2 | Evidencia incompleta | La consulta remota de advisories no fue autorizada en esta ejecución. Los paquetes quedaron fijados por lockfile, pero el operador debe ejecutar el control de vulnerabilidades aprobado por su organización. |
| EXT-HTTPS-001 | S2 | Decisión del operador | Validar certificado público, HSTS y reglas de router/firewall en el dominio final; el ensayo local no sustituye esa comprobación. |

No queda ningún S0/S1 de código conocido en Base. Los S1 residuales afectan
exclusivamente a la certificación Live Audio o a evidencia física todavía no
ejecutada.
