# Contribuir a SeferPresenter

Gracias por tu interés en contribuir a SeferPresenter.

Este proyecto tiene como objetivo proporcionar un software de proyección, exégesis textual e interactiva de grado profesional, soberano, resiliente y de código abierto.

---

## Modelo de licenciamiento

El proyecto se distribuye públicamente bajo la licencia **GNU General Public License v3.0 o posterior (GPL-3.0-or-later)**.

El propietario del proyecto ([CesarJER](https://github.com/CesarJER)) se reserva el derecho de conceder acuerdos o licencias **non-GPLv3** a requerimiento, para casos específicos donde se requiera integración o compatibilidad con proyectos y ecosistemas con licencias no compatibles con copyleft estricto (como RTL u otros).

Todas las contribuciones que se incorporen al repositorio deben estar cubiertas por el [Contributor License Agreement](CLA.md) del proyecto. El CLA permite a los contribuidores conservar la autoría de su trabajo mientras otorgan al propietario los permisos necesarios para mantener este modelo.

---

## Antes de contribuir

1. Revisa los issues y pull requests existentes para coordinar el trabajo.
2. Para cambios sustanciales o adiciones a contratos de red, abre una discusión o issue antes de implementar.
3. Asegúrate de tener los derechos sobre el código que envías.
4. El proceso de firma del [CLA](CLA.md) se realiza automáticamente a través de [CLA Assistant](https://cla-assistant.io/) al enviar un Pull Request.

> **Importante**: Para la política de ramas, formato de commits y PRs, consulta [Flujo Git](docs/development/git-workflow.md).

---

## Principios y calidad técnica

1. **Evidencia y verificación:** Todo cambio funcional debe acompañarse de pruebas automatizadas relevantes en Vitest (`npm test`).
2. **Privacidad y soberanía:** SeferPresenter opera sin telemetría no consentida, sin perfiles permanentes en cliente y con preservación estricta de la intimidad litúrgica y comunitaria.
3. **Calidad de código:** El código debe compilar limpiamente (`npm run build`) y cumplir las reglas de linter (`npm run lint`).
