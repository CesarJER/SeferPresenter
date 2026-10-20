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

## Editar desde dos equipos

Si un equipo modifica Sal 2 y otro Sal 6, sus cambios se combinan al guardar.
Si ambos modifican la misma presentación, aparece **Revisar cambios antes de
guardar** con la versión inicial, el borrador y la versión del servidor. Elija
qué versión conservar para cada registro en conflicto, o cancele para seguir
editando su borrador. La elección se aplica al registro completo; no fusiona
automáticamente líneas de dos versiones de una misma presentación.

En el editor de sincronización, **La presentación ha cambiado** conserva las
marcas sobre las diapositivas anteriores. Compare los textos y las posiciones,
pulse **Actualizar diapositivas y revisar marcas**, ajuste los tiempos y guarde.
Las marcas siguen a los IDs de las diapositivas reordenadas; las de diapositivas
eliminadas y versículos fuera del nuevo rango dejan de aplicarse. Una slide
recreada con otro ID se considera nueva. El aviso cubre cambios detectados con el
editor abierto; no reconstruye versiones anteriores de un mapa ya guardado.

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
