# Fase 3 — Auditoría de Git, políticas y avisos

Fecha de revisión: 2026-07-30  
Alcance: historial y referencias Git, estado del repositorio remoto, fuentes
documentales, avisos de interfaz, artefacto de build y controles de
trazabilidad.  
Estado: auditoría técnica y documental. No determina por sí sola la validez
jurídica de los textos.

## 1. Resultado ejecutivo

**[VERIFICADO EN REPOSITORIO REMOTO]** `CesarJER/SeferPresenter` es un
repositorio privado de GitHub cuya rama predeterminada es `main`. El conector
confirma que la cuenta auditora dispone de permisos administrativos, pero no
expone la configuración de protección de ramas o *rulesets*. Por tanto, la
existencia y el alcance de esas protecciones quedan **[PENDIENTES DE
CONFIRMACIÓN]**.

**[VERIFICADO EN GIT LOCAL]** El estado auditado es
`1eec090fa912ec114dc05bfdcf82fe27b4224dbb`, en la rama
`fix-audience-issues`. `main` local apunta al mismo commit, mientras
`origin/main` permanece en
`6f24088edd0f9eac0632a4300534f64ea34ecba5`, 56 commits por detrás. La revisión
no ha encontrado una referencia remota que identifique el código actualmente
desplegado.

**[VERIFICADO EN GIT LOCAL]** No existen tags, notas Git, workflows bajo
`.github/` ni `CODEOWNERS` en el estado auditado. `package.json` conserva la
versión `0.0.0`. Los avisos no muestran versión documental, fecha de vigencia,
hash de contenido ni commit de build.

**[VERIFICADO EN HISTORIAL LOCAL]** El *reflog* registra una ejecución de
`filter-branch`, múltiples `reset` y `commit --amend`. Además existen, sin
seguimiento Git, un script y salidas que preparan otra reescritura de 56
commits. Esto no demuestra que el remoto acepte *force pushes*, pero sí
demuestra que el historial local se ha reescrito y que un hash no protegido no
es evidencia durable.

**[VERIFICADO EN GIT LOCAL]** Los commits citados por la certificación anterior
todavía son objetos resolubles en este clon, pero no son ancestros de `HEAD` ni
de `origin/main` y ninguna rama los contiene. Podrían desaparecer al expirar los
*reflogs* y ejecutar la recolección de objetos.

**[CONTRADICCIÓN]** La ruta visible `/proteccion-datos` renderiza contenido
embebido en `DataProtectionPage.tsx`; el aviso previo al micrófono mantiene otro
texto en `CollapsiblePrivacyNotice.tsx`; y `public/legal/privacy.md` contiene un
tercer texto. Este último está ignorado por Git, tiene placeholders y no
coincide con la copia existente en `dist/legal/privacy.md`.

## 2. Evidencia de repositorio y versiones

| Elemento | Resultado | Estado |
| --- | --- | --- |
| Repositorio remoto | Privado; rama predeterminada `main`; propietario individual. | **[VERIFICADO EN GITHUB]** |
| Rama auditada | `fix-audience-issues` en `1eec090f…`; `main` local coincide. | **[VERIFICADO EN GIT]** |
| Rama remota | `origin/main` en `6f24088…`, 56 commits detrás de `HEAD`. | **[VERIFICADO EN GIT]** |
| Tags y releases locales | No hay `refs/tags` ni marcadores de release. | **[VERIFICADO EN GIT]** |
| Protección remota | El conector disponible no devuelve branch protection ni rulesets. | **[PENDIENTE DE CONFIRMACIÓN]** |
| Automatización | No existe carpeta `.github`, workflow de CI o `CODEOWNERS`. | **[VERIFICADO EN ÁRBOL]** |
| Versión de producto | `package.json` declara `0.0.0`. | **[VERIFICADO EN CÓDIGO]** `package.json:4` |
| Versión legal visible | Ningún aviso presenta versión, vigencia, hash o commit. | **[VERIFICADO EN INTERFAZ]** |
| Commit desplegado | No hay endpoint, metadato de build ni manifiesto que lo publique. | **[NO DEMOSTRADO]** |
| Artefacto legal | `dist/legal/privacy.md` existe localmente, pero su SHA-256 difiere del fichero fuente actual. | **[CONTRADICCIÓN]** |

La configuración local `core.logAllRefUpdates=true` conserva *reflogs*, pero no
impide reescrituras ni constituye retención protegida. Tampoco se han
encontrado hooks activos: solo están presentes los ejemplos que instala Git.

La documentación oficial de GitHub indica que un *ruleset* puede bloquear
*force pushes* y borrados, exigir pull request, revisiones y *status checks*, y
restringir los *bypass*. Esas reglas deben verificarse en la configuración real,
no inferirse desde el clon:
[reglas disponibles para rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

## 3. Historial y auditabilidad

### 3.1 Reescrituras observadas

El *reflog* contiene, entre otros:

- `filter-branch: rewrite` el 2026-07-12;
- varios `reset` a commits anteriores;
- varios commits enmendados;
- cambios entre ramas de estabilización, auditoría y certificación.

Los ficheros no versionados `rewrite_history.py`, `commits.txt`,
`new_hash.txt` y `script_out.txt` contienen evidencia de una reconstrucción
preparada sobre los 56 commits posteriores a `origin/main`. No se modificaron
ni se ejecutaron durante esta auditoría.

Esto no convierte la reescritura en un defecto por sí misma durante el
desarrollo, pero impide usar la rama mutable como archivo probatorio de
políticas ya publicadas.

### 3.2 Referencias de auditorías anteriores

Las matrices anteriores citan, entre otros, `744d0c0`, `f69a359`, `fd0d25f`,
`cdc1049`, `bec62f0`, `7e938c4` y `e6be288`. Todos resuelven todavía en este
clon, pero:

- no son ancestros de `HEAD`;
- no son ancestros de `origin/main`;
- no están contenidos en ninguna rama local.

El resultado es una trazabilidad frágil: las referencias sobreviven por objetos
locales o *reflogs*, no por una rama, tag o release protegida.

## 4. Inventario de textos y superficies

| Superficie | Origen actual | Despliegue o acceso | Problema principal |
| --- | --- | --- | --- |
| Política visible | `src/components/shared/DataProtectionPage.tsx` | Ruta pública `/proteccion-datos` desde Presenter y Audience. | Texto jurídico embebido en React, sin versión ni dirección postal; combina producto y operador. |
| Enlace general | `src/components/shared/DataProtectionLink.tsx` | Control y Audience. | Apunta a la ruta React; no identifica versión. |
| Aviso Live Audio | `src/features/liveAudio/components/shared/LiveAudioNotice.tsx` | Superficies que incorporen el componente. | Resumen separado de la política. |
| Aviso previo al micrófono | `src/features/liveAudio/components/shared/CollapsiblePrivacyNotice.tsx` | Modal de intervención Audience. | Texto comunitario y bases jurídicas embebidos; no depende del estado real de grabación. |
| Markdown legal | `public/legal/privacy.md` | Vite puede copiarlo a `dist/legal/privacy.md`; Node también sirve `public/`. | Ignorado por Git, con placeholders, contradicciones y sin consumidor desde interfaz. |
| Copia de build | `dist/legal/privacy.md` | Artefacto local ignorado. | Obsoleta respecto al Markdown fuente; no demuestra lo desplegado. |
| Auditorías antiguas | `docs/audits/2026-07-22` y `2026-07-24` | Documentación del repositorio. | Mezclan certificación técnica y afirmaciones ya superadas; referencias fuera de ramas. |

Evidencia de rutas: `src/App.tsx:835-836`,
`src/main-audience.tsx:329-336`,
`src/components/shared/DataProtectionLink.tsx:24`,
`src/features/liveAudio/components/shared/LiveAudioNotice.tsx:10`.  
Evidencia del aviso previo:
`src/features/liveAudio/components/audience/AudienceInterventionModal.tsx:88`,
`src/features/liveAudio/components/shared/CollapsiblePrivacyNotice.tsx:25-72`.  
Evidencia de build: `Dockerfile:27-30`, `Dockerfile:47-49`.

## 5. Matriz de coherencia documental

| Afirmación o control | React visible | Markdown legal | Código inventariado | Resultado |
| --- | --- | --- | --- | --- |
| Alias ilegible para servidor | Reconoce que puede procesarlo. | Afirma E2E absoluto. | Existe perfil activo con alias en claro. | **[CONTRADICCIÓN]** |
| IndexedDB | No lo menciona. | Afirma que se usa. | No se encontró uso de IndexedDB. | **[CONTRADICCIÓN]** |
| Quiz individual | Reconoce estado temporal individual. | Habla de agregados anónimos. | El servidor mantiene y expone detalle por sesión. | **[CONTRADICCIÓN]** |
| Grabación | Dice que las reuniones pueden grabarse. | Placeholder de disponibilidad. | No existe estado de grabación integrado. | **[NO DEMOSTRADO EN RUNTIME]** |
| Responsable | Variables Vite con alerta parcial si falta nombre. | Placeholders. | Compose solo pasa nombre, ID, correo y web. | **[INCOMPLETO]** |
| Versión aplicable | No visible. | No visible. | No hay manifiesto o endpoint. | **[AUSENTE]** |

El historial de Git no resuelve estas contradicciones: permite saber qué cambió
en los componentes versionados, pero no qué Markdown ignorado o qué copia de
`dist` se publicó.

## 6. Pruebas de avisos y barreras

No se encontraron pruebas unitarias o de integración que importen
`DataProtectionPage`, `DataProtectionLink`, `LiveAudioNotice` o
`CollapsiblePrivacyNotice`. Tampoco hay pruebas que demuestren de extremo a
extremo:

1. que la política es accesible sin autenticación;
2. que una compilación destinada a producción falla ante placeholders o
   identidad incompleta;
3. que el aviso previo refleja si la retransmisión/grabación está realmente
   activa;
4. que el micrófono no puede publicarse sin superar la barrera vigente;
5. que un cambio de estado de grabación invalida una confirmación anterior;
6. que la versión visible coincide con el contenido legal incluido en el build;
7. que ningún fichero `.local` entra en Git, `dist`, contexto Docker o imagen.

Las auditorías anteriores registran pruebas generales y casos manuales de
accesibilidad, pero eso no equivale a una regresión automatizada del contenido,
versión y vigencia de los avisos.

## 7. Hallazgos

### F3-01 — No existe un origen legal único, versionado y desplegable

- Severidad: **S2 — alto**
- Estado: **[VERIFICADO]**
- Causa: tres textos independientes; el Markdown legal está ignorado y el build
  local contiene una copia diferente.
- Riesgo: publicar información contradictoria o no poder demostrar qué versión
  conoció una persona.
- Cierre: fuente jurídica única, salida generada determinista, hash y versión
  visibles, y prueba de igualdad con el artefacto.

### F3-02 — El remoto no identifica el estado auditado o desplegado

- Severidad: **S2 — alto**
- Estado: **[VERIFICADO]**
- Causa: `origin/main` está 56 commits detrás y no existe manifiesto de
  despliegue.
- Riesgo: no poder reconstruir la combinación de código, configuración no
  secreta y documentos que estaba activa en una fecha.
- Cierre: push revisado, release del producto, manifiesto de despliegue y
  comprobación del SHA servido.

### F3-03 — Historial y referencias legales sin protección durable demostrada

- Severidad: **S2 — alto**
- Estado: reescritura local **[VERIFICADA]**; protección remota
  **[PENDIENTE DE CONFIRMACIÓN]**.
- Causa: historial reescrito, sin tags/releases y sin evidencia accesible de
  rulesets.
- Cierre: repositorio documental privado separado, rama protegida, tags
  protegidos y releases inmutables sin *bypass* ordinario.

### F3-04 — Certificaciones anteriores apuntan a commits fuera de ramas

- Severidad: **S3 — medio**
- Estado: **[VERIFICADO]**
- Riesgo: pérdida de objetos y ruptura de matrices de trazabilidad después de
  expirar *reflogs* o ejecutar `git gc`.
- Cierre: recrear la evidencia sobre commits alcanzables y releases inmutables;
  no presentar como vigente una certificación cuyo commit no está publicado.

### F3-05 — Avisos y barrera de micrófono sin pruebas específicas

- Severidad: **S2 — alto**
- Estado: **[VERIFICADO]**
- Riesgo: que una refactorización elimine, desactualice o desacople el aviso sin
  que falle CI.
- Cierre: pruebas de contenido estructural, accesibilidad, vigencia, estado de
  grabación, bloqueo de publicación y exclusión de datos locales.

### F3-06 — Contenido específico de operador dentro del producto general

- Severidad: **S2 — alto**
- Estado: **[VERIFICADO]**
- Causa: el aviso React presupone actividades religiosas, comunidad,
  grabaciones y bases jurídicas.
- Riesgo: otros operadores heredan declaraciones inexactas.
- Cierre: componente y plantilla neutros; adaptación jurídica del operador
  dentro de su repositorio documental privado y solo salida legal revisada en
  `public/legal/`.

### F3-07 — El fichero legal público queda ignorado por la regla general de `public`

- Severidad: **S2 — alto**
- Estado: **[VERIFICADO]**
- Evidencia: `.gitignore:18-20`; `git check-ignore -v
  public/legal/privacy.md` devuelve la regla `public/*`.
- Riesgo: cambios legales silenciosos y builds diferentes desde el mismo
  commit.
- Cierre: corregir la jerarquía de exclusión cuando el texto sea verdadero y
  revisado; seguir excluyendo toda adaptación `*.local*`.

## 8. Estrategia de versiones propuesta

### 8.1 Separación de repositorios y fuentes

**Repositorio general de SeferPresenter**

- especificación técnica de tratamientos;
- plantilla legal neutra;
- componentes genéricos;
- esquema y generador;
- pruebas estructurales;
- ningún dato identificativo de una comunidad.

**Repositorio documental privado de cada operador**

- datos del responsable y contactos;
- decisiones jurídicas y registro de revisiones;
- inventario de proveedores y canales reales;
- política, avisos y carteles adaptados;
- actas de aprobación;
- evidencias de publicación y retirada.

Mientras no exista el segundo repositorio, su borrador permanece en
`docs/privacy/audits/<operator>.local/`. `SEFER_PRIVACY_LOCAL_PATH` solo actúa
como puntero de herramientas y no debe incorporarse al frontend.

`public/legal/` contendrá únicamente salidas legales públicas revisadas. No
contendrá auditorías, inventarios, decisiones internas ni datos de trabajo.

### 8.2 Identidad de cada versión legal

Cada documento publicado debe incluir un manifiesto con:

```text
documentId
documentVersion
effectiveAt
language
operatorDocumentRevision
productCommit
buildCommit
contentSha256
supersedes
changeClass: legal | functional | factual | editorial
approvedByRole
approvedAt
```

La interfaz debe mostrar al menos `documentVersion` y `effectiveAt`, y exponer
el hash completo en una vista técnica o manifiesto público. El registro no debe
incluir identificadores individuales de participantes solo para probar que
vieron o aceptaron el aviso.

### 8.3 Publicación y custodia

1. preparar cambios en rama;
2. ejecutar validación de esquema, placeholders, enlaces, accesibilidad y
   coherencia con el inventario técnico;
3. requerir pull request y revisión del rol jurídico/privacidad;
4. generar la salida legal y su manifiesto de forma determinista;
5. crear un tag específico, por ejemplo
   `legal/privacy/v2026.07.30.1`;
6. publicar una release inmutable con el documento, manifiesto y checksums;
7. desplegar solo esa release y registrar su identificador;
8. verificar desde producción versión, hash y commit;
9. conservar la versión sustituida como archivo, con su periodo de vigencia.

GitHub documenta que las releases inmutables bloquean el movimiento o borrado
del tag asociado y la modificación de activos después de publicarlas:
[releases inmutables](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

### 8.4 Reglas mínimas del repositorio documental

- repositorio privado;
- *ruleset* sobre la rama predeterminada;
- bloqueo de *force push* y borrado;
- pull request obligatorio;
- al menos una revisión independiente y aprobación de `CODEOWNERS` para
  documentos legales;
- invalidación de aprobaciones al cambiar el contenido;
- aprobación del último *push* por una persona distinta;
- resolución obligatoria de conversaciones;
- checks requeridos y actualizados con la rama;
- bypass limitado a recuperación excepcional, auditado y no utilizable para
  publicación ordinaria;
- tags `legal/**` protegidos;
- releases inmutables;
- copias cifradas y prueba periódica de restauración.

## 9. Matriz de pruebas requerida

| ID | Control | Resultado exigido |
| --- | --- | --- |
| LEG-01 | Ruta pública | La política responde sin autenticación y con documento completo. |
| LEG-02 | Configuración | El build de operador falla si faltan campos obligatorios o quedan placeholders. |
| LEG-03 | Versión | Versión, vigencia y hash coinciden entre interfaz, manifiesto y release. |
| LEG-04 | Reproducibilidad | Mismo commit, perfil y lockfiles producen el mismo contenido legal. |
| LEG-05 | Barrera | No se crea ni publica pista de micrófono sin superar el aviso vigente. |
| LEG-06 | Cambio de estado | Iniciar grabación/retransmisión invalida la confirmación previa y vuelve a informar. |
| LEG-07 | Separación | Ningún `*.local*` aparece en índice Git, build, contexto Docker o imagen. |
| LEG-08 | Neutralidad | El build general no contiene identidad ni hechos de una comunidad concreta. |
| LEG-09 | Enlaces | Todos los avisos enlazan a la misma versión aplicable. |
| LEG-10 | Historial | La release y su tag no pueden moverse ni borrarse mediante el flujo ordinario. |

## 10. Decisiones para las fases siguientes

- La Fase 4 debe usar la especificación técnica como fuente del mapa de
  tratamientos; no debe copiar afirmaciones del Markdown ignorado.
- La Fase 5 debe asignar bases jurídicas y obligaciones solo tras distinguir
  producto, operador y plataformas externas.
- La remediación deberá convertir los avisos en consumidores de una fuente
  legal única, implantar versión visible y añadir las pruebas LEG-01 a LEG-10.
- La política definitiva no se publicará hasta reconciliar alias, quiz,
  grabación, menores, proveedores, transferencias y retención con el código y
  las decisiones locales verificadas.

## 11. Verificación de esta fase

- inspección de referencias, ramas, *reflog*, configuración, objetos y
  divergencia con `origin/main`;
- consulta de metadatos del repositorio privado y contenido de `main` mediante
  el conector de GitHub;
- revisión de las fuentes React, Markdown, build y enlaces;
- comparación SHA-256 entre `public/legal/privacy.md` y
  `dist/legal/privacy.md`;
- búsqueda de pruebas, workflows, `CODEOWNERS`, tags, notas y marcadores de
  versión;
- comprobación de exclusión Git de documentos `.local`;
- no se ejecutó ni modificó el script de reescritura;
- no se modificó código de producto;
- no se ejecutó build: la fase es documental y el artefacto existente se
  examinó únicamente como evidencia no confiable.
