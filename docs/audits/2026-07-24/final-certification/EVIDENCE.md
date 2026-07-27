# Evidencia de verificación

## Línea base

- Rama: `codex/final-certification`
- Código remediado: `e6be288`
- Node.js: `v24.15.0`
- npm: `11.12.1`
- Docker Engine: `29.6.1`
- Docker Compose: `v5.3.0`

No se registran valores del `.env`, secretos ni el contenido del manifiesto del
operador.

## Automatización

Resultado final de la frontera de código:

```text
npm.cmd run test
49 archivos, 356 pruebas: PASS

npx.cmd tsc --noEmit
PASS

npm.cmd run lint
PASS

npm.cmd run build
PASS (Vite 8.0.13, audience-sw-build.js generado)
```

Pruebas dirigidas de la última fase:

```text
livekitSecurity.test.ts + serverAuth.test.ts
2 archivos, 31 pruebas: PASS

LiveAudioAccessibility.test.tsx
1 archivo, 13 pruebas: PASS
```

## Docker y red interna

Imágenes verificadas:

| Componente | Identificador |
| --- | --- |
| App | `sha256:b5efe42e0d9f90dadd4b27c623a5ea12a21d41561f0ad954efe588de9a228d98` |
| Caddy | `sha256:77c07d5ebfa5be9fd6c820d2094ae662c9e7eeb9bf98346b7f639900263ee2a2` |
| Redis | `sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99` |
| LiveKit | `sha256:2c6869d2d5ff6c9c0166f47be1c92dad6928bfecfa5e4060a6ece48db8accfa3` |

Comprobaciones:

```text
docker compose --profile live-audio config --quiet: PASS
app, caddy, redis y livekit: running/healthy
TCP 7881: publicado y escuchando
UDP 50000-50050: publicado
GET /api/health: 200 {"status":"ok"}
GET /api/livekit/status: 200 {"enabled":true,"available":true}
```

Durante la prueba se reprodujo y corrigió un 401 de RoomService causado por usar
la ruta pública. `LIVEKIT_API_URL=http://livekit:7880` separa ahora el control
interno de la URL WebSocket pública.

## Evidencia que requiere entorno externo

No se simularon ni se declaran superadas:

- dos pasadas físicas NVDA, VoiceOver y TalkBack;
- acceso desde datos móviles y redes restrictivas;
- tres Controles y 50 Audience;
- pérdida, reorden y duplicación de paquetes;
- cambio real de IP pública/DDNS;
- TURN/TLS con dominio y certificado del operador;
- certificado/HSTS del dominio de producción;
- escaneo remoto de advisories no autorizado.
