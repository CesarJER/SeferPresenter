# SeferPresenter

SeferPresenter es una aplicación web autohospedada para dirigir presentaciones
multilingües, proyectar textos y medios, y compartir una sesión con una audiencia.
Un operador trabaja desde Control; Presenter muestra la proyección y Audience
permite seguirla desde otros dispositivos.

## Estado del proyecto

En preparación para su primera publicación estable. El manifiesto conserva
`0.0.0` y todavía no se ha certificado un candidato de release. El alcance,
los bloqueos y las evidencias pendientes están en [TODO](TODO.md) y en la
[guía de preparación](docs/guides/prepare-release.md).

La licencia de distribución del código sigue pendiente de elección e incorporación.
Los activos de terceros tienen sus [avisos propios](static/audio/sounds/THIRD_PARTY_NOTICES.md);
esos avisos no establecen una licencia para el resto del proyecto.

## Qué permite hacer

- Seleccionar y editar presentaciones; navegar entre diapositivas y controlar
  fondos, texto, música y vídeo.
- Sincronizar la proyección desde Control hacia Presenter y Audience mediante
  un backend común.
- Consultar y proyectar referencias de un corpus instalado por el operador.
- Realizar actividades de quiz con respuestas locales y resultados agregados.
- Habilitar Live Audio para escuchar, pedir palabra y moderar micrófonos.
- Habilitar Voice Scripture para interpretar referencias habladas mediante STT
  local. Su reconocimiento depende del corpus, motor, hardware y entorno.

Live Audio y Voice Scripture son opcionales y requieren configuración propia.
La reproducción y captura también dependen de permisos, interacción del usuario
y restricciones del navegador; el estado sincronizado no garantiza recepción
física de audio.

## Pantallas de una sesión

| Ruta | Uso |
| --- | --- |
| `/control` | Operación, edición, navegación y administración |
| `/presenter` | Pantalla de proyección |
| `/audience` | Recepción e interacción permitida para participantes |
| `/audio-editor` | Edición de mapas de sincronización de audio |
| `/proteccion-datos` | Información de privacidad de la instalación |

Para probar el recorrido completo, use [primera sesión](docs/guides/first-session.md).

## Probarlo en desarrollo local

Necesita Git, npm y una versión de Node compatible con el lockfile:
`^20.19.0 || >=22.12.0`. Docker no es necesario para el frontend/backend base.

```sh
git clone https://github.com/CesarJER/SeferPresenter.git
cd SeferPresenter
npm ci
npm run dev
```

En PowerShell puede usar `npm.cmd`. Abra la URL indicada por Vite y añada
`/control`. Prepare una presentación de prueba si el catálogo está vacío.

`dev` inicia Vite y el backend local. Por defecto desactiva autenticación si
no se configuró; este inicio rápido es para desarrollo, no para exponer una
instalación a Internet. Revise cualquier `.env` existente antes de arrancar.

El arranque inicializa datos ausentes desde ejemplos neutrales. No incluye
corpus ni medios del operador y `dev` no genera el corpus. Para instalar,
configurar HTTPS/autenticación, habilitar voz o ejecutar un artefacto construido,
siga [operación](docs/operations/deployment.md). Los hooks de build pueden escribir
corpus; `deploy` además optimiza medios y utiliza configuración privada de instancia.

## Datos y privacidad de una instalación

Presentaciones, mapas, corpus, medios, branding y configuración de instancia
residen en `SEFER_DATA_DIR`, separados del producto. Hay
[ejemplos neutrales](examples/SeferPrivateData/README.md) para preparar una instalación.

El árbol `public/` de esa raíz puede servirse a visitantes: estar fuera de Git
no significa ser confidencial. La política aplicable, retención y permisos
dependen también del operador y su despliegue. Revise
[privacidad](docs/privacy/README.md) antes de incorporar participantes o datos reales.

## Documentación y colaboración

[docs/README.md](docs/README.md) es la entrada común para usuarios, operadores,
desarrolladores y agentes de IA.

- [Arquitectura](docs/architecture/overview.md) y
  [sincronización](docs/architecture/synchronization.md): responsabilidades y autoridad.
- [HTTP y realtime](docs/api/README.md): interfaces, permisos, errores y límites.
- [Desarrollo](docs/development/guide.md) y [AGENTS.md](AGENTS.md): cómo descubrir,
  modificar y validar el proyecto preservando cambios existentes.
- [Live Audio](docs/features/live-audio.md) y
  [Voice Scripture](docs/features/voice-scripture.md): comportamiento y limitaciones.
- [ADR](docs/adr/README.md): decisiones y evidencia histórica.

Para comunicar un problema, incluya commit/versión, configuración pertinente,
pasos, resultado esperado y observado. Use ejemplos sintéticos y retire
credenciales, transcripciones y datos de participantes. Los resultados de una
prueba local deben distinguirse de una verificación en dispositivos y redes reales.
