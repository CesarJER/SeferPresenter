# Fase 10 — Controles organizativos y evidencia de grabación

Fecha: 2026-07-31  
Alcance: barrera de participación de menores, manifiesto no nominativo,
procedimientos de derechos e incidentes y revisión de proveedores.  
Estado: implementación completada; validación final indicada en este informe.

## 1. Resultado ejecutivo

Se ha separado la confirmación general de la confirmación específica del
micrófono y del camino de edad. Para el tramo inferior al umbral configurado se
exige una declaración adicional de presencia y autorización parental. Todo el
estado permanece en el navegador: no se transmite ni persiste edad,
consentimiento o filiación.

El backend genera un manifiesto JSON no nominativo por cada intervalo declarado
como `recording`. Contiene fechas, canales y versiones, huella de la política,
comprobaciones y resultado. No contiene participantes, alias, IP, voz, quiz ni
identificadores técnicos de sesión.

Se han creado modelos internos para gestionar derechos y brechas, incluidas
simulaciones sintéticas. La revisión de proveedores distingue hechos
confirmados de evidencias contractuales que solo puede exportar el operador.

## 2. Cambios técnicos

- barrera local de lectura, micrófono, tramo de edad y autorización parental;
- cancelación sin publicación de voz;
- callback interno tras aceptar cambios de estado externo;
- escritor atómico serializado de manifiestos `.local.json`;
- volumen Compose interpolado desde `SEFER_PRIVACY_LOCAL_PATH`;
- versión de software, aviso, canales y política configurables;
- pruebas de contenido prohibido, integración WS, montaje y UI.

## 3. Límites

- La declaración parental es una barrera básica, no una verificación fuerte de
  edad o representación.
- El manifiesto acredita una acción en SeferPresenter, no que OBS o una
  plataforma externa estuvieran efectivamente grabando.
- Los procedimientos documentales necesitan una simulación firmada y uso real.
- No se cierra una revisión contractual sin exportar condiciones y
  configuración de las cuentas aplicables.

## 4. Base normativa consultada

Se contrastaron el umbral español de 14 años y la necesidad de autorización del
titular de la patria potestad o tutela cuando el consentimiento sea la base; los
plazos de atención de derechos; y la evaluación/notificación de brechas en 72
horas. Las decisiones específicas del operador se mantienen fuera de este
informe general.

## 5. Estado de remediaciones

| Control | Resultado |
| --- | --- |
| PR-06 — menores | Implementado y probado; validación de uso real pendiente |
| PR-11 — manifiesto | Implementado, probado y verificado en Compose |
| PR-12 — incidentes | Playbook/plantilla creados; simulación pendiente |
| PR-13 — derechos | Procedimiento/plantilla creados; simulación pendiente |
| PR-14 — proveedores | Parcial; faltan evidencias de cuenta/contrato |

## 6. Verificación

- `npm.cmd run test`: **PASS**, 42 archivos y 275 tests.
- `npx.cmd tsc --noEmit`: **PASS**.
- `npm.cmd run lint`: **PASS**.
- `npm.cmd run build`: **PASS**.
- `docker compose --profile live-audio up -d --build --wait`: **PASS**; app,
  Redis y LiveKit saludables y Caddy en ejecución.
- manifiesto sintético dentro del volumen Compose: **PASS**; estado completado,
  inicio/fin, dos canales, versión de política y SHA-256, sin datos personales.
- auditoría de logs: **PASS**, cero coincidencias para IP, autorización, JWT,
  campos sensibles y token en query.
- Audience, protección de datos, Markdown legal configurado y estado LiveKit:
  **HTTP 200**.
