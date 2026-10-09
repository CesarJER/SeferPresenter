# Realizar una primera sesión

Para una instalación ya configurada. Si necesita instalarla, siga
[operación](../operations/deployment.md). Esta tarea permite comprobar
Control → Presenter/Audience con una presentación sencilla.

## Prerrequisitos y comprobación previa

- Conocer la URL de la instancia y disponer de credenciales de operador.
- Tener una presentación de prueba sin datos privados, con al menos dos slides.
  Si el catálogo está vacío, prepararla/importarla desde Control antes de empezar.
- Backend disponible; disponer de navegadores para Control, Presenter y Audience.
- Primera prueba sin funciones opcionales; habilitarlas después según sus guías.

## Pasos y resultado esperado

1. Abrir `/control` y autenticarse. Comprobar autorización de Control; si queda
   pendiente, autorizarlo desde el principal siguiendo el código temporal.
2. Abrir `/presenter` en la pantalla de proyección.
3. Seleccionar la presentación de prueba y una slide desde Control.
   Presenter debe mostrar su contenido.
4. Abrir `/audience` en otro navegador/dispositivo. En modo controlado completar
   alias/solicitud y admisión. Audience debe mostrar la slide activa sin controles
   de navegación.
5. Cambiar a la segunda slide desde Control y comprobar ambos displays.
   Repetir con Presenter cerrado: Audience debe seguir la navegación aplicada
   por backend.
6. Reabrir Presenter y comprobar que obtiene el estado actual. Si se incluye
   audio/vídeo, activar reproducción mediante gesto cuando el navegador lo requiera
   y verificar pausa/seek en los dispositivos previstos.
7. Cerrar la sesión de prueba conforme al procedimiento del operador y comprobar
   el efecto esperado en Audience; no borrar datos del operador para diagnosticar.

## Fallos y condiciones de parada

Sin catálogo o media/corpus requerido, volver a preparación. Si Control queda
pendiente o recibe 403, comprobar autorización/conexión antes de repetir acciones.
Si Audience no entra, revisar modo/admisión. Un medio bloqueado por autoplay
requiere interacción local; no demuestra fallo de snapshots.

Ante display incoherente, registrar ruta/rol, slide y pasos reproducibles sin
capturar secretos o datos privados. Consulte
[sincronización](../architecture/synchronization.md) y [operación](../operations/deployment.md).
Detener la prueba si no puede explicar quién conserva autoridad o qué datos
se perderían al recuperar. Esta prueba breve no sustituye los criterios de release.
