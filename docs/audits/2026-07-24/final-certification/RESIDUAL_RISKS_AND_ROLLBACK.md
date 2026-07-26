# Riesgos residuales y rollback

## Riesgos aceptados o pendientes

1. **Dispositivo completamente offline.** Una revocación no puede conocerse
   hasta recuperar conectividad. Al reconectar se validan sesión, credencial y
   revisión; no se promete DRM.
2. **IP pública dinámica.** El fallback descubre la IP al arrancar LiveKit. Un
   cambio posterior exige reiniciar ese servicio.
3. **Redes restrictivas.** ICE/TCP 7881 mitiga el bloqueo UDP. TURN/TLS requiere
   configuración propia y sigue siendo condición de producción cuando la red
   objetivo lo necesite.
4. **Accesibilidad física.** La automatización no sustituye NVDA, VoiceOver ni
   TalkBack reales.
5. **Escala soportada.** La meta de decenas, con máximo de ensayo 50 Audience,
   requiere todavía la ejecución externa registrada.
6. **Instancia única.** Un reinicio elimina estado efímero de sesión; no existe
   HA ni se certifica.
7. **Cadena de suministro.** El lockfile aporta reproducibilidad, pero falta el
   control remoto de advisories aprobado por la organización.

## Estrategia de rollback

- Cada fase está aislada en un commit. Revertir únicamente el commit de la fase
  afectada y reconstruir la imagen.
- No revertir una fase posterior sin revisar sus dependencias en
  `COMMIT_TRACEABILITY.md`.
- Antes de cambios de persistencia, conservar y validar el backup fuera del
  contenedor.
- Para desactivar Live Audio sin afectar Base:
  `SEFER_LIVE_AUDIO_ENABLED=false` y
  `VITE_SEFER_LIVE_AUDIO_BUILD=false`, seguido de rebuild del frontend.
- Ante problemas de acceso, no borrar la caché estática global. Revocar o rotar
  la sesión y dejar que el cliente limpie solo el almacén dinámico protegido.
- Ante cambio DDNS, reiniciar LiveKit; no rotar secretos ni reconstruir la app
  salvo que exista otra causa.

