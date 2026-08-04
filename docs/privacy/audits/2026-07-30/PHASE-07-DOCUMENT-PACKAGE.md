# Fase 7 — Paquete documental

Fecha: 2026-07-30  
Estado: borradores completos; publicación bloqueada por correcciones P0/P1.

## 1. Documentos generales versionables

- `docs/privacy/technical-privacy-specification.md`
- `docs/privacy/operator-compliance-guide.md`
- `docs/privacy/templates/operator-privacy-policy-template-es.md`

Son neutrales, no asumen entidad religiosa, España, grabación, proveedores,
consentimiento, EIPD o DPD.

## 2. Documentos específicos

Los documentos internos adaptados se encuentran en la carpeta `.local` del
operador:

- RAT;
- LIA;
- cribado y borrador EIPD;
- conservación;
- proveedores/transferencias;
- plan de correcciones.

Los textos destinados a publicación se encuentran en una carpeta `.local`
dentro de `public/legal/`:

- política completa;
- avisos breves;
- cartel;
- historial legal.

`public/legal/` no recibió auditorías, inventarios ni notas técnicas.

## 3. Criterios adoptados

- política real separada de plantilla;
- hechos técnicos separados de decisiones del operador;
- grabación externa atribuida al operador, no al software;
- asistencia pasiva distinta de intervención;
- consentimiento explícito para voz pública;
- alias visible separado;
- no afirmar anonimato de voz;
- no afirmar alias E2E, quiz agregado, TTL o logs sin IP hasta implementarlos;
- archivo histórico con revisión por evento;
- documentos/versiones vinculables a manifiesto sin datos de asistentes.

## 4. Bloqueos de publicación

1. alias E2E sin ruta clara;
2. quiz exclusivamente agregado;
3. prueba que preserve el Audience pasivo de OBS sin alias/lista;
4. estado real de grabación e invalidación de micrófono;
5. logs máximo siete días sin IP;
6. TTL/purga de navegador;
7. versión legal vinculada al despliegue;
8. procedimientos de derechos e incidentes;
9. revisión contractual de proveedores.

## 5. Verificación de fase

- separación general/local aplicada;
- ficheros específicos excluidos del Git principal;
- solo documentos legales bajo `public/legal/`;
- estructura A-K cubierta;
- no se modificó código de producto;
- no se ejecutó build.
