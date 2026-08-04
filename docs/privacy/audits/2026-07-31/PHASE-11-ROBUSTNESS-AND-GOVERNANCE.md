# Fase 11 — Robustez, caché legal y gobernanza documental

Fecha: 2026-07-31  
Alcance: PR-15 a PR-18 y reverificación de PR-03.  
Estado: implementación técnica completada; validación final de runtime indicada
al cierre del informe.

## 1. Resultado ejecutivo

El descubrimiento de IP pública del servidor deja de ser implícito y deja de
usar HTTP. La configuración exige una IP explícita o un opt-in para consultar
dos endpoints HTTPS permitidos; valida que el resultado sea IPv4 y falla de
forma segura ante ausencia o respuesta inválida.

Los documentos legales y `/proteccion-datos` quedan fuera de Cache Storage y se
sirven con `Cache-Control: no-store`. Si no pueden obtenerse por red, la interfaz
no debe presentar una copia obsoleta como política vigente.

El aviso previo al micrófono informa expresamente del riesgo de decir el nombre,
de voces de fondo y de subtítulos automáticos. También se ha preparado un plano
neutral para el futuro repositorio jurídico privado sin crearlo.

## 2. Cambios

- `LIVEKIT_NODE_IP_AUTO_DETECT=false` como valor general seguro;
- autodetección HTTPS allowlist, timeouts y validación IPv4;
- service worker `1.3.0`, rutas legales network-only/no-store;
- cabeceras HTTP no-store desde el backend;
- advertencia visible antes de la publicación de voz y en reconfirmaciones;
- plano de contenido, roles, rulesets, tags, checks y recuperación para el
  repositorio jurídico.

## 3. Gobernanza del futuro repositorio

Se propone repositorio privado institucional, MFA, mínimo privilegio, PR y
revisión obligatorios, CODEOWNERS, descarte de aprobaciones obsoletas, bloqueo de
force-push/borrado y tags protegidos. Los expedientes reales con datos personales
no deben entrar en Git por la dificultad de expurgarlos de todo el historial.

PR-15 permanece abierto hasta crear y verificar el repositorio después de
Shabbat y cuando el operador confirme organización, plan, propietarios y copia
cifrada.

## 4. Estado

| ID | Resultado |
| --- | --- |
| PR-03 | Conservado por prueba negativa; observación OBS real pendiente |
| PR-15 | Plano y checklist preparados; repositorio no creado |
| PR-16 | Implementado, probado y verificado en runtime |
| PR-17 | Implementado, probado y verificado en runtime |
| PR-18 | Implementado y probado; validación UX real pendiente |

## 5. Verificación

- `npm.cmd run test`: **PASS**, 42 archivos y 278 tests.
- `npx.cmd tsc --noEmit`: **PASS**.
- `npm.cmd run lint`: **PASS**.
- `npm.cmd run build`: **PASS**.
- Compose con perfil Live Audio: **PASS**; app, LiveKit y Redis saludables y
  Caddy en ejecución.
- IP dinámica: **PASS**; `LIVEKIT_NODE_IP` vacío, opt-in activo y LiveKit sano.
- `/proteccion-datos`: HTTP 200 y `Cache-Control: no-store, max-age=0`.
- política configurada: HTTP 200, `draft-3` y `no-store`.
- service worker: HTTP 200 y versión `1.3.0`.
- auditoría de logs: cero IPv4/IPv6, autorización, JWT, campos sensibles y
  tokens en query.

## 6. Conclusión

PR-16 y PR-17 quedan cerrados con evidencia técnica. PR-18 está implementado y
solo necesita observación UX. PR-15 queda deliberadamente abierto hasta la
creación posterior del repositorio y su prueba independiente.
