# Fase 13 — Revisión integral de cierre y efectividad

Fecha: 2026-08-04  
Alcance: sincronización, autenticación, Live Audio, quiz, almacenamiento,
documentos legales, caché, logs y controles de despliegue.  
Clasificación: informe general y versionable; no contiene identidad, dominio,
credenciales ni decisiones particulares de un operador.

## 1. Opinión ejecutiva

La implementación técnica presenta un nivel **satisfactorio con mejoras
operativas pendientes**. No se identificaron hallazgos críticos ni altos en la
revisión. Las barreras principales funcionan en código, pruebas y en el
despliegue inspeccionado:

- Audience recibe un `SYNC_STATE` público reducido y no necesita autenticarse;
- Control y Presenter conservan rutas protegidas para el estado completo;
- el stream y snapshot de quiz para Control requieren autenticación;
- el perfil operativo Live Audio rechaza expresamente cualquier `alias` claro;
- alias, mensajes y listas visibles se transportan como señales privadas
  cifradas;
- el servidor conserva hashes de deduplicación y contadores agregados de quiz,
  con umbral mínimo de tres para publicar resultados;
- los documentos legales desplegados coinciden por SHA-256 con sus fuentes,
  usan `no-store` y el renderizador descarta HTML e imágenes;
- la auditoría de logs no detectó IP, cabeceras de autorización, JWT, campos
  sensibles ni tokens en query;
- las dependencias de producción no presentan vulnerabilidades conocidas según
  `npm audit --omit=dev` en la fecha de revisión.

Queda un hallazgo medio condicionado al uso: el quiz abierto no ofrece una
garantía de «una persona, un voto» para decisiones vinculantes. La retención se
ejecuta al instalarse, queda programada semanalmente con `StartWhenAvailable` y
se verificó con resultado programado `0`.

## 2. Metodología y evidencia

Se aplicaron inspección, reejecución, análisis estructural y pruebas de runtime:

1. reindexación completa mediante codebase-memory: 2.696 nodos y 5.954
   relaciones;
2. búsqueda y trazado de rutas, llamadas, flujos de datos y consumidores;
3. comparación SHA-256 entre módulos del repositorio y contenedor;
4. inspección de rutas públicas y protegidas sin imprimir configuración ni
   variables de entorno;
5. auditoría count-only de logs;
6. comprobación de documentos legales, cabeceras y variantes de traversal;
7. ejecución completa de tests, tipos, lint y auditoría de dependencias.

Quedan fuera de esta evidencia una captura real de tráfico E2E, una sesión
multidispositivo completa con voz y OBS, las simulaciones organizativas y la
aprobación jurídica de documentos de cada operador.

## 3. Resultados por superficie

| Superficie | Evidencia | Resultado |
| --- | --- | --- |
| Sincronización Audience | `getStateSyncPaths` separa `/api/audience/state` y `/api/audience/events`; ambos devuelven 200. El estado observado fue `SYNC_STATE` y no expuso más de la diapositiva activa. | **PASS** |
| Acceso controlado | El Control principal cambia la política; Audience solicita con alias E2E y recibe una credencial efímera. Snapshot, SSE, quiz y LiveKit aplican la misma admisión. | **PASS técnico y de runtime HTTP; sesión visual multidispositivo pendiente** |
| Estado de Control | `/api/state` y `/api/state-events` devuelven 401 sin credenciales; el estado autenticado devuelve 200 y `SYNC_STATE`. | **PASS** |
| Quiz de Control | `/api/quiz-control-events` y `/api/quiz-control-state` rechazan acceso anónimo; el snapshot autenticado devuelve `QUIZ_AGGREGATE_SNAPSHOT` y umbral 3. | **PASS** |
| Alias | El tipo de perfil no contiene alias y las validaciones de cliente/servidor rechazan el campo. El contenido se cifra mediante ECDH P-256 y AES-GCM. | **PASS técnico; tráfico real pendiente** |
| Lista visible | Control calcula solo aliases voluntarios no ocultados y cifra una lista individual únicamente para Audience activos autorizados. | **PASS técnico** |
| Quiz agregado | IDs independientes, hashes acotados, capacidad máxima y publicación con grupo mínimo. No existe registro nominativo ni persistencia en disco. | **PASS para gamificación** |
| Estado externo | Cambiar a `live` o `recording` revoca permisos de voz previos y exige una nueva acción/confirmación antes de publicar. | **PASS técnico; sesión real pendiente** |
| Almacenamiento Audience | Envoltura versionada con expiración, purga de formato inválido/antiguo y limpieza en logout/rotación. | **PASS automático; reloj real pendiente** |
| Legal | Markdown con `skipHtml`, imágenes deshabilitadas, rutas contenidas, SHA-256 coincidente y `Cache-Control: no-store`. | **PASS** |
| PWA | API, WS, LiveKit, tokens, política y `/legal/` están en la exclusión absoluta de caché. | **PASS** |
| Logs | Aplicación con driver acotado; proxy, SFU y Redis sin driver legible. Auditoría count-only con todos los contadores a cero. | **PASS de contenido** |
| Retención temporal | Comprobación inmediata correcta, tarea semanal `Ready`, `StartWhenAvailable`, resultado `0` y próxima ejecución verificada. | **PASS** |
| Manifiesto de grabación | Generación no nominativa, ruta contenida y ausencia de términos sensibles en la muestra observada. | **PASS** |

## 4. Hallazgos

### F13-01 — Retención temporal dependiente de que Docker esté activo

- Riesgo inicial: **medio**.
- Condición inicial: la tarea diaria estaba instalada y el script funcionaba manualmente,
  pero su última ejecución devolvió código `1` cuando el motor Docker no estaba
  disponible.
- Criterio: el máximo temporal debe ser automático y sostenible, no depender de
  que un administrador arranque Docker antes de una hora concreta.
- Causa inicial: disparador diario fijo sin reintento al iniciar Docker o al comenzar el
  despliegue.
- Efecto: un contenedor puede conservar logs más de 144 horas aunque el volumen
  esté acotado por tamaño.
- Recomendación original: ejecutar la comprobación al instalar la tarea y
  reprogramarla con tolerancia a suspensión; se considera cumplida con la
  corrección siguiente.
- Corrección aplicada: el instalador ejecuta la rotación inmediatamente y crea
  un disparador semanal para la fecha exacta situada siete días después, con
  ejecución diferida automática si el equipo no estaba disponible.
- Evidencia: tarea `Ready`, `LastTaskResult=0`, próxima ejecución
  `2026-08-11 19:49`; los contenedores actuales eran menores de 144 horas.
- Estado: **cerrado y verificado**.

### F13-02 — Quiz abierto no apto para votaciones vinculantes

- Riesgo: **medio condicionado al uso**; bajo para gamificación ordinaria.
- Condición: el endpoint público evita identidad y limita memoria, pero confía
  en identificadores generados por el cliente. Un cliente hostil puede generar
  varios IDs válidos, alterar agregados o consumir la capacidad disponible.
- Criterio: una decisión vinculante requiere integridad y una regla verificable
  de elegibilidad/unicidad.
- Causa: anonimato abierto deliberado, sin credencial de participación de un
  solo uso.
- Efecto: los resultados sirven como autoevaluación colectiva, no como prueba
  de «una persona, un voto».
- Recomendación: documentar la prohibición de usar el modo actual para
  decisiones vinculantes. Si se necesita votación formal, diseñar un modo
  separado con credenciales efímeras de un solo uso y evaluación específica.
- Estado: **riesgo residual aceptable solo para gamificación**.

## 5. Seguimiento de remediaciones

| Control | Estado de Fase 13 | Evidencia restante |
| --- | --- | --- |
| PR-01 — alias E2E | Remediación completa; pendiente de verificación | Captura controlada de tráfico sin contenido legible |
| PR-02 — quiz agregado | Remediación completa; pendiente de verificación | Prueba multidispositivo y resistencia a abuso |
| PR-03 — Audience pasivo | Cerrado por prueba negativa | Observación periódica con salida OBS |
| PR-04/05 — estado y voz | Remediación completa; pendiente de verificación | Sesión real `off/live/recording` con LiveKit |
| PR-06 — menores | Remediación completa; pendiente de verificación | Observación de la barrera en navegador real |
| PR-07 — logs | Cerrado | Revisión periódica del resultado de la tarea |
| PR-08 — TTL | Remediación completa; pendiente de verificación | Expiración temporal en navegador real |
| PR-09 — autenticación | Cerrado | Revisión periódica y rotación operativa |
| PR-10 — fuente legal | Cerrado técnicamente | Aprobación jurídica del operador |
| PR-11 — manifiesto | Cerrado técnicamente | Revisión periódica de muestras |
| PR-12/13 — incidentes y derechos | Documentado | Simulaciones organizativas firmadas |
| PR-14 — proveedores | Parcial | Evidencia contractual y de cuenta |
| PR-15 — repositorio jurídico | Abierto | Crear, proteger y probar el repositorio independiente |
| PR-16/17 — IP y caché | Cerrado técnicamente | Revisión periódica |
| PR-18 — UX | Cerrado por tests/revisión previa | Observación del modal durante una sesión real |

## 6. Verificación automatizada

- `npm.cmd run test`: **PASS**, 43 archivos y 289 tests.
- `npx.cmd tsc --noEmit`: **PASS**.
- `npm.cmd run lint`: **PASS**.
- `npm.cmd audit --omit=dev`: **PASS**, 0 vulnerabilidades.
- `npm.cmd run build`: **PASS**.
- `docker compose --profile live-audio up -d --build --wait`: **PASS**; app,
  Caddy, Redis y LiveKit saludables.
- Smoke test interno: bootstrap, estado y ticket Audience devolvieron 200 sin
  imprimir el valor de la credencial.
- El único cambio previo no relacionado que permanece en el árbol de trabajo es
  el fichero local de presentaciones; no forma parte de esta auditoría.

## 7. Conclusión

No se requiere otra refactorización general de privacidad. El cierre depende de
pruebas operativas controladas y de los controles organizativos/jurídicos
propios de cada operador.
