# Política de Seguridad (Security Policy)

En el proyecto **SeferPresenter**, la privacidad, la integridad técnica y la soberanía de los datos son principios fundamentales. Agradecemos el reporte responsable de cualquier problema o vulnerabilidad de seguridad.

---

## 1. Versiones soportadas

Actualmente, las actualizaciones de seguridad y correcciones se aplican sobre la rama principal (`main`) y las versiones preliminares activas:

| Versión | Soporte de seguridad |
| :--- | :--- |
| `0.1.0-alpha` | ✅ Soportada (versión activa actual) |
| `< 0.1.0` | ❌ No soportada |

---

## 2. Reporte responsable de vulnerabilidades

Si descubres una vulnerabilidad potencial de seguridad en SeferPresenter, **por favor no abras un Issue público ni publiques los detalles técnicos en foros abiertos**.

Para coordinar una resolución responsable:

1. **Vía preferente:** Utiliza la función privada de [GitHub Security Advisories](https://github.com/CesarJER/SeferPresenter/security/advisories) en el repositorio para enviar un informe confidencial (*Report a vulnerability*).
2. **Vía directa:** Contacta directamente con el mantenedor a través de su perfil de GitHub en [https://github.com/CesarJER](https://github.com/CesarJER).

### Información útil a incluir:
- Descripción detallada de la vulnerabilidad y vector de ataque.
- Pasos exactos o prueba de concepto (PoC) para reproducir el fallo con datos sintéticos (nunca utilices datos reales de participantes ni credenciales de producción).
- Versión o commit del código afectado y entorno de ejecución (navegador, versión de Node.js, perfiles de Docker activos).
- Impacto estimado en la confidencialidad, integridad o disponibilidad.

---

## 3. Proceso de respuesta y divulgación

1. **Acuse de recibo:** El mantenedor acusará recibo del reporte en un plazo razonable tras su recepción.
2. **Evaluación:** Se verificará la reproducibilidad del fallo en un entorno aislado con datos de prueba neutrales.
3. **Remediación:** Se desarrollará y validará la corrección técnica en una rama privada, incorporando pruebas automatizadas que prevengan regresiones.
4. **Publicación coordinada:** Se publicará la actualización y, en caso necesario, un aviso de seguridad (*Security Advisory*) explicando el alcance, mitigación y versiones corregidas.

---

## 4. Comprobaciones automáticas en Pull Requests

Toda contribución enviada al proyecto mediante Pull Request debe superar las siguientes comprobaciones automatizadas:

- **Firma del CLA:** Aceptación obligatoria del [Contributor License Agreement](CLA.md) a través de CLA Assistant.
- **Calidad de código y tipado:** Ejecución limpia de `npm run lint` y compilación de tipos `tsc -b`.
- **Suite de pruebas:** Superación del 100% de las pruebas automatizadas (`npm test`).
- **Verificación de build:** Compilación exitosa del empaquetado de producción (`npm run build`).
