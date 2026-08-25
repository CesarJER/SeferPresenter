# Documentación de privacidad

Esta carpeta contiene la documentación general y versionable de privacidad de
SeferPresenter. Las evidencias e informes específicos de cada despliegue viven
fuera del repositorio principal. Los documentos aplicables del operador viven
en el Git privado anidado `SEFER_DATA_DIR/legal/`.

## Contenido versionable

Solo debe contener hechos técnicos comunes al producto, plantillas neutras,
guías para operadores e informes de auditoría sin datos identificativos de una
comunidad concreta.

Estructura inicial:

```text
docs/privacy/
├── README.md
├── audits/
└── templates/
```

Los documentos definitivos se añadirán después del inventario técnico, el mapa
de tratamientos y las respuestas del operador. Una plantilla no debe
presentarse como política aplicable por defecto.

Documentación general:

- `technical-privacy-specification.md`: comportamiento, datos, cifrado,
  almacenamiento y garantías reales del producto.
- `operator-compliance-guide.md`: decisiones y controles para cada despliegue.
- `legal-repository-blueprint.md`: estructura y reglas del repositorio jurídico
  privado y su cadena verificable.
- `templates/operator-privacy-policy-template-es.md`: plantilla neutral que
  requiere adaptación y validación.

Informes disponibles:

- `audits/2026-07-28/PHASE-01-ORIENTATION.md`: orientación, alcance y primeras
  contradicciones.
- `audits/2026-07-29/PHASE-02-TECHNICAL-INVENTORY.md`: inventario de datos,
  flujos, almacenamiento, retención y hallazgos técnicos.
- `audits/2026-07-30/PHASE-03-GIT-POLICIES-NOTICES.md`: historial Git,
  superficies legales, versiones desplegables y estrategia de custodia.
- `audits/2026-07-30/PHASE-04-MASTER-PROCESSING-MAP.md`: tabla maestra de
  tratamientos del producto, flujos y requisitos para convertirla en ROPA.
- `audits/2026-07-30/PHASE-05-LEGAL-ANALYSIS.md`: análisis jurídico general,
  bases, artículo 9, derechos, EIPD, ROPA, DPD, LSSI y límites de publicación.
- `audits/2026-07-30/PHASE-06-PROVISIONAL-AUDIT-REPORT.md`: consolidado
  ejecutivo, hallazgos, inventario, flujos y matriz código-documentación.
- `audits/2026-07-30/PHASE-07-DOCUMENT-PACKAGE.md`: estructura, criterios y
  bloqueos del paquete documental general y local.
- `audits/2026-07-31/PHASE-08-TECHNICAL-REMEDIATION.md`: implementación de alias
  E2E, quiz agregado, protección del Audience pasivo y estado declarado de
  retransmisión/grabación con revocación de micrófonos.
- `audits/2026-07-31/PHASE-09-RETENTION-AUTH-LEGAL-SOURCE.md`: TTL de Audience,
  autenticación fail-closed, minimización/retención de logs y fuente legal
  Markdown con versión y SHA-256.
- `audits/2026-07-31/PHASE-10-ORGANIZATIONAL-CONTROLS.md`: barrera de menores,
  manifiesto no nominativo, derechos, incidentes y proveedores.
- `audits/2026-07-31/PHASE-11-ROBUSTNESS-AND-GOVERNANCE.md`: autodetección IP
  HTTPS opt-in, caché legal, avisos de autoidentificación y plano Git privado.
- `audits/2026-07-31/PHASE-12-LEGAL-UX.md`: renderizado visual de Markdown legal,
  tabla de primera capa previa a intervenir, huella sin ruta interna y revisión
  responsiva.
- `audits/2026-08-04/PHASE-13-CLOSURE-REVIEW.md`: reverificación integral con
  codebase-memory y runtime, estado de cierre, riesgos residuales y evidencia
  automatizada.

## Auditorías locales

Cada operador debe mantener las auditorías específicas fuera del repositorio
de producto, normalmente bajo su `SeferPrivateData` privado:

```text
SeferPrivateData/audit/
├── README.local.md
├── phase-01-orientation.local.md
└── ...
```

No se debe depender solamente de un sufijo `.local` para separar este material.
Antes de retirar una copia del checkout se debe verificar el destino privado y
comparar su inventario SHA-256:

```powershell
git -C ../SeferPrivateData status --short
```

No se deben colocar secretos, credenciales ni datos personales reales en los
informes, aunque sean locales.

## Ficheros legales del operador

Cada publicación vive en `SEFER_DATA_DIR/legal/releases/NNNNNN/`. Una secuencia
existente es inmutable: cualquier corrección crea la siguiente. Los informes de
auditoría, incidentes y expedientes con datos personales no se sirven como
documentos legales y requieren su propio almacenamiento restringido.

## Puntero mediante `.env`

Un despliegue puede declarar su raíz documental privada con:

```dotenv
SEFER_PRIVACY_LOCAL_PATH=../SeferPrivateData/audit
```

Compose consume únicamente `session-manifests.local/` bajo
`SEFER_PRIVACY_LOCAL_PATH` y lo monta en el backend; el resto de la auditoría
privada no entra en la aplicación. La política y el resumen se publican mediante
las URL estables `/legal/privacy.md` y `/legal/privacy-summary.md`; la ruta física
no es configurable desde el frontend.

El backend valida todos los hashes y la cadena antes de servir documentos. El
ancla `SEFER_DATA_DIR/config/legal-activation.json` impide activar una secuencia
inferior o cambiar el manifiesto de una secuencia ya activada.
