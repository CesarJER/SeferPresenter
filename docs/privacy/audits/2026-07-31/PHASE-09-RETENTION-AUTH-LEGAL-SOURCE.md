# Fase 9 — Retención, autenticación y fuente legal

Fecha: 2026-07-31  
Alcance: PR-07, PR-08, PR-09 y PR-10.  
Estado: implementación y despliegue técnico completados en la instancia
inspeccionada; quedan como seguimiento la rotación de credenciales aplazada, la
prueba de TTL en navegador real y la primera rotación automática por antigüedad.

## 1. Resultado ejecutivo

- Audience guarda referencia de sesión, respuestas y puntuaciones en envolturas
  versionadas con TTL: 24 horas por defecto, configurable entre 1 y 168 horas.
  Expiración, formatos antiguos/malformados, logout y rotación purgan el dato.
- La autenticación administrativa pasa a ser fail-closed: está habilitada si
  `SEFER_REQUIRE_AUTH` no existe y solo se desactiva con `false` explícito. El
  script de desarrollo opta por `false` localmente cuando no se configuró.
- La política deja de estar embebida en React. `/proteccion-datos` carga un
  Markdown contenido bajo `/legal/` y muestra versión y SHA-256 del texto exacto.
- Node no lee IP ni `User-Agent`; Caddy elimina `X-Real-IP` y
  `X-Forwarded-For` hacia Node/LiveKit.
- Caddy, LiveKit y Redis usan driver Docker `none`, porque su salida real puede
  contener direcciones ICE/IP o valores con forma de token. La aplicación usa
  driver `local`, comprimido, tres ficheros de 5 MB.
- Se añade una auditoría de logs que solo devuelve conteos y nunca imprime las
  líneas coincidentes.

## 2. Límite de Docker y diseño de retención

Los drivers Docker `json-file` y `local` ofrecen rotación por tamaño/número, no
por edad. Por ello Compose por sí solo no puede expresar «eliminar tras siete
días».

La solución general evita montar el socket Docker dentro de un contenedor y no
modifica directamente los ficheros internos del daemon:

1. `rotate-docker-logs.ps1` inspecciona la fecha de creación de los contenedores;
2. a las 144 horas ejecuta `docker compose up -d --force-recreate`;
3. Docker elimina contenedores antiguos y sus logs gestionados;
4. bind mounts y volúmenes con contenido/backups permanecen intactos;
5. `install-docker-log-retention-task.ps1` instala una ejecución diaria con
   `StartWhenAvailable`.

El margen de 144 horas más la frecuencia diaria mantiene el objetivo por debajo
de siete días si la tarea está instalada. Un host apagado no genera nuevos logs
y ejecuta la tarea al volver a estar disponible.

Referencias técnicas: documentación oficial de los drivers
[`json-file`](https://docs.docker.com/engine/logging/drivers/json-file/) y
[`local`](https://docs.docker.com/engine/logging/drivers/local/), manipulación
[`header_up`](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) y
configuración de [LiveKit](https://github.com/livekit/livekit/blob/master/_autodocs/configuration.md).

## 3. Criterios por corrección

| ID | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| PR-07 | Logs app acotados; terceros descartados; cabeceras IP eliminadas; auditor count-only; recreación a 144 h | `docker-compose.yml`, `Caddyfile`, scripts y tests de logging | Desplegado; tarea instalada y ejecución inicial correcta; observar primera recreación por edad |
| PR-08 | TTL envelope para sesión/quiz Audience y purga de legado/expirado | `privacyStorage.ts`, hooks y tests | Desplegado y probado automáticamente; prueba temporal en navegador real pendiente |
| PR-09 | Autenticación requerida por ausencia/default; opt-out explícito solo | `authUtils.mjs`, `dev.mjs`, tests HTTP/WS existentes | Desplegado; petición HTTP protegida sin credenciales rechazada con 401 |
| PR-10 | Markdown legal configurable, ruta contenida, versión y hash visible; aviso neutral según estado | `legalDocument.ts`, `DataProtectionPage.tsx`, aviso Live Audio, `public/legal/privacy.md` | Desplegado; ruta, versión y SHA-256 del documento seleccionado verificados |

## 4. Hallazgo de runtime

La auditoría del despliegue preexistente no pasó: encontró IP y valores con
forma JWT en logs de terceros. El detalle y los conteos pertenecen al informe
`.local`; no se copiaron líneas ni valores a documentación versionable.

El resultado confirmó la causa raíz y justificó descartar esos streams en el
driver, en vez de confiar en expresiones de redacción frágiles. Los contenedores
anteriores fueron retirados mediante `compose down`; la instancia nueva usa
`local` solo para la app y `none` para Caddy, LiveKit y Redis. La auditoría
count-only del nuevo log de aplicación devolvió cero coincidencias.

## 5. Fuente legal

`VITE_PRIVACY_POLICY_PATH` admite solo rutas absolutas bajo `/legal/`, sin `..`,
barra inversa ni extensiones distintas de `.md`. El fallback neutral es
`/legal/privacy.md`. Un operador puede seleccionar un documento legal `.local`
durante el build sin introducir sus datos en el código general.

La página usa `cache: no-store`, muestra el hash completo y, ante un error, no
presenta texto alternativo como si fuera la política aplicable: informa del
fallo y pide no facilitar datos ni activar micrófono.

## 6. Incidente de validación

Una comprobación inicial de Compose expandió el `.env` en la salida privada de
la tarea. No se incorporan valores a este informe. El operador ha aplazado la
rotación y autorizado provisionalmente el uso de las credenciales existentes;
la rotación posterior y su registro pertenecen exclusivamente al expediente
local.

Prevención incorporada: las revisiones posteriores usan
`docker compose config --no-interpolate` o herramientas que imprimen solo
conteos.

## 7. Condiciones de cierre

Estado de las condiciones de cierre:

1. rotar las credenciales expuestas: **PENDIENTE por decisión del operador**;
2. recrear los contenedores: **COMPLETADO**;
3. instalar la tarea de retención: **COMPLETADO**, ejecución inicial con código 0;
4. repetir auditoría de logs: **COMPLETADO** para el único stream persistente,
   con cero coincidencias; los demás streams se descartan;
5. probar expiración/logout/rotación en navegador real: **PENDIENTE**; cubierto
   por pruebas automatizadas;
6. comprobar rechazo no autorizado: **COMPLETADO** para HTTP con 401 y cubierto
   por tests HTTP/WS;
7. comparar ruta, versión y SHA-256 legal desplegado: **COMPLETADO**.

## 8. Siguiente fase

Tras cerrar los pasos productivos anteriores, la siguiente fase puede abordar
PR-06 y PR-11 a PR-14: barrera de menores, manifiesto no nominativo, incidentes,
derechos y revisión de proveedores.

## 9. Verificación

- `npm.cmd run test -- --maxWorkers=1`: **PASS**, 40 ficheros y 269 tests.
- `npx.cmd tsc --noEmit`: **PASS**.
- `npm.cmd run lint`: **PASS**.
- `npm.cmd run build`: **PASS**.
- Parseo sintáctico de ambos scripts PowerShell: **PASS**.
- `docker compose config --no-interpolate --quiet`: **PASS**; el sandbox no
  permitió leer el fichero de configuración del cliente Docker, sin afectar al
  parseo de Compose.
- Validación de `Caddyfile` con la imagen del despliegue: **PASS**.
- `rotate-docker-logs.ps1 -DryRun`: **PASS**, sin recrear servicios.
- Exclusión Git local y carácter versionable de `public/legal/privacy.md`:
  **PASS**.
- `docker compose --profile live-audio down` y posterior `up -d --build`:
  **PASS**; app, Redis y LiveKit saludables y Caddy en ejecución.
- Healthcheck de LiveKit actualizado del endpoint obsoleto `/alive` a `GET /`,
  conforme a la documentación oficial y verificado con HTTP 200.
- Drivers efectivos: app `local`; Caddy, LiveKit y Redis `none`.
- Auditoría count-only del nuevo log app: **PASS**, cero IP, cabeceras de
  autorización, JWT aparentes, campos sensibles y tokens en query.
- Tarea `SeferPresenter-Privacy-Log-Retention`: instalada a las 03:30 y
  ejecutada manualmente con resultado 0; primera recreación por edad pendiente.
- Verificación runtime por el endpoint HTTPS público: Audience, página de
  privacidad, documento legal y estado LiveKit 200; ruta protegida sin
  credenciales 401.
