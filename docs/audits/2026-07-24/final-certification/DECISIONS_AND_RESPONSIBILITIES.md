# Decisiones y responsabilidades

## Decisiones de producto

- SeferPresenter es software self-hosted de instancia única; no se certifican
  réplicas, alta disponibilidad ni un SaaS central.
- Base y Live Audio se evalúan por separado.
- El servidor es autoridad exclusiva de participantes, admisión, permisos,
  ownership, cola, moderación, políticas y `stateRevision`.
- El overlay E2E solo enriquece datos privados entre Controles. Nunca modifica
  estado técnico autoritativo.
- Público/Controlado es moderación de acceso, no autenticación fuerte ni prueba
  de identidad.
- La grabación es declarativa. SeferPresenter no controla grabadores externos.
- El shell y los recursos estáticos permanecen offline; el estado protegido solo
  se almacena después de admisión verificada y nunca se convierte en autoridad.
- `dist` sigue siendo el artefacto del build personalizado del operador.
- `*.local` y `*.local.*` se reservan exclusivamente a adaptaciones privadas.

## Responsabilidad del software

- Validar configuración obligatoria y fallar con un diagnóstico seguro.
- No persistir alias legibles ni correspondencias nominales en el servidor.
- Versionar snapshots, deltas y políticas; detectar huecos y resincronizar.
- Aplicar TTL, rotación, logout y limpieza de credenciales/estado protegido.
- Proteger rutas, tickets, tokens, SSE y WS según el modo de acceso.
- Mantener Base utilizable cuando Live Audio esté desactivado o no disponible.
- Exponer hechos técnicos y renderizar Markdown local sin HTML crudo.
- Ofrecer semántica, foco, regiones vivas y controles operables.

## Responsabilidad del administrador del despliegue

- Completar `.env` y montar `privacy.local.md` cuando corresponda, sin
  versionarlos.
- Construir la imagen con su identidad y assets públicos.
- Gestionar secretos, certificados, DNS/DDNS, backups y actualizaciones.
- Reenviar TCP 7881 y UDP 50000-50050 para Live Audio.
- Reiniciar LiveKit después de un cambio de IP pública anunciado por DDNS.
- Añadir TURN/TLS con dominio y certificado propios si su entorno lo requiere.
- Ejecutar pruebas de restauración, red móvil, carga y dispositivos reales.
- Mantener un proceso aprobado de revisión de vulnerabilidades.

## Decisiones de la organización operadora

- Identidad y contacto del responsable, base jurídica y textos legales.
- Disponibilidad, estado inicial y mutabilidad de la declaración de grabación.
- Modo de acceso inicial y reglas internas para cambiarlo.
- Retención, grabación externa, encargados, transferencias y respuesta a
  derechos.
- Política de alias, moderación y personas autorizadas como Control.
- Necesidad de TURN/TLS, HSTS y requisitos de continuidad adicionales.

