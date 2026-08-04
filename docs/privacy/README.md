# Documentación de privacidad

Esta carpeta contiene la documentación general y versionable de privacidad de
SeferPresenter. Las evidencias e informes específicos de cada despliegue viven
en una subcarpeta de auditoría `.local`, fuera del repositorio principal.
`public/legal/` se reserva exclusivamente para ficheros legales.

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
- `legal-repository-blueprint.md`: estructura y reglas mínimas del futuro
  repositorio jurídico privado.
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

## Auditorías locales

Cada operador debe usar bajo `docs/privacy/audits/` una carpeta privada con
nombre terminado en `.local` y documentos con marcador `.local.`:

```text
docs/privacy/audits/<operator-slug>.local/
├── README.local.md
├── phase-01-orientation.local.md
└── ...
```

Las reglas `*.local` y `*.local.*` de `.gitignore` mantienen estas auditorías
fuera del repositorio principal. Antes de añadir datos del operador debe
comprobarse la exclusión:

```powershell
git check-ignore -v -- docs/privacy/audits/<operator-slug>.local/README.local.md
```

No se deben colocar secretos, credenciales ni datos personales reales en los
informes, aunque sean locales.

## Ficheros legales locales

`public/legal/` no debe contener auditorías, evidencias, informes de fase ni
notas de trabajo. Cuando se generen adaptaciones legales de un operador, pueden
vivir temporalmente en `public/legal/<operator-slug>.local/`, que también está
ignorado, pero todos sus ficheros deben ser documentos legales destinados a
revisión o publicación.

## Puntero mediante `.env`

Un despliegue puede declarar su raíz documental privada con:

```dotenv
SEFER_PRIVACY_LOCAL_PATH=./docs/privacy/audits/<operator-slug>.local
```

Compose consume únicamente `session-manifests.local/` bajo
`SEFER_PRIVACY_LOCAL_PATH` y lo monta en el backend; el resto de la auditoría
privada no entra en la aplicación. Es distinto de
`VITE_PRIVACY_POLICY_PATH`, que selecciona exclusivamente un documento Markdown
legal bajo `/legal/` para `/proteccion-datos`. Nunca apunte esta última variable
a una auditoría, EIPD, incidente o evidencia interna.

La selección legal rechaza escapes de directorio y muestra versión/SHA-256. Los
documentos de auditoría local no se copian a `public/legal/` ni al `dist`.
`VITE_PRIVACY_SUMMARY_PATH` selecciona de forma independiente la tabla legal de
primera capa que aparece en el aviso previo a intervenir, con fallback neutral
en `/legal/privacy-summary.md`; la adaptación del operador debe mantenerse en
la misma carpeta legal `.local` que su política.

## Repositorio privado posterior

Cuando los documentos del operador alcancen suficiente madurez, la carpeta
local podrá convertirse en un repositorio separado con acceso restringido,
protección de rama, revisiones obligatorias y etiquetas firmadas. Hasta entonces
el control principal es la exclusión verificable del repositorio de producto.
