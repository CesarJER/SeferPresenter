# SeferPresenter v0.1.0-alpha

Primera pre-release pública de **SeferPresenter**, enfocada en pruebas locales, evaluación de arquitectura y validación de la experiencia de proyección e interacción en tiempo real.

---

## 🚀 Capacidades principales

### 1. Sistema multi-pantalla y sincronización en tiempo real
- **`/control` (Operador):** Consola para editar presentaciones, cambiar diapositivas, gestionar capas de texto, vídeo y audio de fondo, y moderar sesiones.
- **`/presenter` (Proyección):** Pantalla limpia de visualización diseñada para proyectores o monitores principales.
- **`/audience` (Audiencia):** Interfaz ligera para seguir la sesión desde dispositivos móviles o secundarios en red local.
- **Protocolo de sincronización:** Backend centralizado con WebSockets y SSE para replicación inmediata del estado de la presentación.

### 2. Catálogo y gestión de medios
- Navegación, guardado e importación de presentaciones.
- Soporte para fondos dinámicos, imágenes y música sincronizada.
- Herramienta selectiva de efectos de vídeo: `npm run pingpong -- <archivo.mp4>` (mediante `ffmpeg-static` para generar bucles ping-pong sin saltos visuales).

### 3. Editor de audio y actividades interactivas
- **`/audio-editor`:** Herramienta visual para marcar y sincronizar pistas de audio con fragmentos de texto.
- **Módulo de Quiz en vivo:** Ejecución de cuestionarios interactivos en memoria RAM con votación en tiempo real y resultados agregados en pantalla.

### 4. Módulos opcionales avanzados
- **Live Audio LAN (LiveKit WebRTC):** Retransmisión de voz en directo en red local con solicitud de palabra y moderación de micrófonos.
- **Voice Scripture (STT local):** Detección e interpretación de referencias bíblicas/textuales mediante Whisper local sin dependencias de servicios externos en la nube.

---

## ⚖️ Licencia y contribuciones

- **Licencia principal:** [GNU General Public License v3.0 or later](LICENSE) (`GPL-3.0-or-later`).
- **Copyright:** (C) 2026 [CesarJER](https://github.com/CesarJER).
- **Contribuciones:** Todo colaborador debe aceptar el [Contributor License Agreement (CLA)](CLA.md). Revise [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar un Pull Request.
- **Licenciamiento puntual non-GPLv3:** Para peticiones específicas de inclusión o integración en entornos con licencias incompatibles con copyleft (como proyectos con soporte RTL u otros), contacte al autor en [https://github.com/CesarJER](https://github.com/CesarJER).
- **Avisos de terceros:** Atribuciones de efectos de sonido, librerías de software y herramientas de terceros disponibles en el informe detallado [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## ⚠️ Requisitos, límites y notas de uso

1. **Entorno de ejecución:** Requiere Node.js `^20.19.0 || >=22.12.0` y npm.
2. **Despliegue local:** El modo `npm run dev` arranca sin autenticación obligatoria y está pensado exclusivamente para desarrollo en red local aislada. No exponer directamente a Internet sin proxy inverso con HTTPS y autenticación configurada.
3. **Persistencia de sesión:** Las sesiones activas residen en memoria RAM del servidor; el reinicio del proceso restablece la sesión activa.
4. **Hardware para Voice Scripture:** El reconocimiento de voz local por STT requiere recursos adecuados de CPU/GPU según el modelo de Whisper configurado.
