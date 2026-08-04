# Fase 12 — Presentación visual de documentos legales

Fecha: 2026-07-31  
Alcance: `/proteccion-datos`, información de primera capa previa a intervenir,
integridad visible y seguridad de dependencias.  
Estado: implementación y despliegue completados; textos locales pendientes de
aprobación jurídica final.

## 1. Resultado ejecutivo

La política deja de mostrarse como un bloque de texto sin jerarquía y pasa a
renderizar Markdown estructurado: encabezados, párrafos, listas, enlaces y
tablas GFM. La página usa una tarjeta responsiva con cabecera identificable y
ajusta palabras, celdas y márgenes para evitar desbordamientos horizontales. El
contenedor legal ocupa `100dvh` y gestiona su propio desplazamiento vertical,
evitando que el `overflow: hidden` global de los modos de presentación lo
bloquee.

La indicación `Fuente: /legal/...` se elimina por no aportar información útil al
usuario y revelar una ruta interna. La política completa se identifica mediante
versión y SHA-256 íntegro; el aviso breve muestra la misma versión y los últimos
12 caracteres del hash.

El aviso previo a intervenir incorpora la información básica de primera capa en
forma de tabla inmediatamente antes del enlace a la política detallada. La tabla
se carga desde un Markdown separado mediante `VITE_PRIVACY_SUMMARY_PATH`. No se
muestra junto al campo de alias y se elimina el párrafo redundante que afirmaba
que Control podría leer o responder públicamente a alias o mensajes.

La estructura de cinco epígrafes y la remisión posterior a la información
detallada siguen el modelo por capas recomendado por la
[AEPD](https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos/derecho-de-informacion).

## 2. Arquitectura de contenido

| Elemento | Fuente general | Adaptación del operador |
| --- | --- | --- |
| Política completa | `public/legal/privacy.md` | `public/legal/<operator>.local/privacy-policy-*.local.md` |
| Información básica de primera capa | `public/legal/privacy-summary.md` | `public/legal/<operator>.local/privacy-summary-*.local.md` |
| Informes y evidencias | `docs/privacy/audits/<fecha>/` | `docs/privacy/audits/<operator>.local/` |

`public/legal/` continúa reservado exclusivamente a documentos legales. Los
datos de identidad, contacto y prácticas concretas del operador no se incluyen
en el fallback general.

## 3. Seguridad del renderizado

- `react-markdown` interpreta el documento sin usar `dangerouslySetInnerHTML`;
- `remark-gfm` habilita tablas de información por capas;
- `skipHtml` descarta HTML embebido;
- las imágenes se deshabilitan para impedir recursos de seguimiento desde el
  documento;
- las rutas se contienen bajo `/legal/` y rechazan escapes de directorio;
- política y avisos se solicitan con `cache: no-store` y reciben cabeceras
  `no-store` del backend.

La implementación sigue la recomendación del proyecto `react-markdown` de usar
`remark-gfm` para tablas y componentes personalizados para controlar la salida.

## 4. Verificación visual y funcional

- escritorio, 1440 px: jerarquía, ancho de lectura, tarjeta y metadatos
  verificados;
- anchura 500 px, por debajo del breakpoint `sm` de 640 px: borde derecho,
  saltos de palabra y contenido completo verificados;
- Chrome real confirmó `clientHeight=484`, `scrollHeight=9333`,
  `overflow-y=auto` y desplazamiento efectivo de `scrollTop=0` a `1200`;
- la misma comprobación de navegador confirmó el SHA-256 completo en la
  política principal;
- el intento automatizado a 430 px con Chrome headless para Windows aplicó una
  anchura efectiva mínima y recortó la captura, por lo que no se usa como
  evidencia del viewport solicitado;
- la información básica local devuelve HTTP 200 y contiene los cinco epígrafes
  recomendados: responsable, finalidad, legitimación, destinatarios y derechos;
- pruebas DOM confirman tabla GFM, descarte de HTML, versión/huella y ausencia
  de la ruta `Fuente` y del párrafo redundante;
- la tabla hereda el tamaño de fuente del resto del aviso y precede al enlace a
  la segunda capa.

La tabla se verificó mediante el DOM del componente y el Markdown servido en
producción. No se obtuvo captura del modal desplegado porque el Audience pasivo
de la sesión de comprobación no presentó el control de participación; no se
simuló una sesión activa ni se alteró su estado para forzarlo.

## 5. Dependencias

La revisión detectó una alerta moderada preexistente en DOMPurify 3.4.3, usado
por otros renderizadores del producto. Se actualizó de forma aislada a 3.4.12.
La auditoría de dependencias de producción queda en cero vulnerabilidades.
La auditoría completa mantiene cuatro alertas limitadas al toolchain de
desarrollo (`@babel/core`, `brace-expansion`, `postcss` y `vite`): una baja y
tres altas. No forman parte de la instalación `npm ci --omit=dev` de la imagen
final y no se aplicó un `npm audit fix` general.

## 6. Criterios de aceptación

| Criterio | Resultado |
| --- | --- |
| Política legible y responsiva | Cumplido |
| Desplazamiento vertical independiente | Cumplido |
| Tabla de primera capa antes del enlace a la política | Cumplido mediante Markdown configurable |
| Sin tabla duplicada junto al alias | Cumplido |
| Contenido comunitario fuera del producto general | Cumplido mediante `.local` |
| Sin ruta interna visible | Cumplido |
| Versión y huella verificables | Cumplido |
| HTML arbitrario/imagen desde Markdown bloqueados | Cumplido por tests |
| Vulnerabilidades de producción | 0 |

## 7. Pendiente

La política y la información básica local siguen siendo borradores. La Fase 12 cierra el
problema técnico y visual, pero no sustituye su aprobación jurídica final ni la
creación posterior del repositorio legal privado.

## 8. Verificación final

- `npm.cmd run test`: **PASS**, 43 archivos y 283 tests.
- `npx.cmd tsc --noEmit`: **PASS**.
- `npm.cmd run lint`: **PASS**.
- `npm.cmd run build`: **PASS**.
- `npm.cmd audit --omit=dev`: **PASS**, 0 vulnerabilidades.
- Compose recreado: app, LiveKit y Redis saludables; Caddy en ejecución.
- política y aviso local: HTTP 200 y `Cache-Control: no-store`.
- auditoría de logs: cero IPv4/IPv6, cabeceras de autorización, JWT, campos
  sensibles o tokens en query.
- `git diff --check`: **PASS**.
