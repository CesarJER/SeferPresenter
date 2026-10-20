# Trabajar en SeferPresenter

Entrada común para personas e IA: [docs/README.md](docs/README.md).
Procedimiento de cambio y validación: [desarrollo](docs/development/guide.md).
No mantener un catálogo paralelo de símbolos ni otra arquitectura en este archivo.

## Antes de editar

- Comprobar raíz del checkout, rama, HEAD y `git status --short`.
- Preservar todos los cambios preexistentes y archivos sin seguimiento.
- Delimitar el cambio y seguir productores, validadores, handlers y consumidores.
- No ejecutar despliegues, reinicios, migraciones, generadores de corpus ni
  operaciones sobre datos de instancia como validación incidental.
- Mantener ejemplos sintéticos y datos/secretos del operador fuera del producto.
- Operaciones de Git y límites de autorización: seguir estrictamente [docs/development/git-workflow.md](docs/development/git-workflow.md).

## Descubrimiento del código

Preferir codebase-memory-mcp cuando esté disponible. Comprobar identidad,
raíz/rama/HEAD, frescura y cobertura del índice; indexar si el proyecto no está
indexado. El grafo ayuda a navegar, no demuestra comportamiento runtime.

1. `search_graph`: localizar símbolos con patrones o consultas acotadas.
2. `trace_path`: seguir callers, callees y caminos de datos.
3. `get_code_snippet`: leer el qualified_name encontrado.
4. `query_graph` / `get_architecture`: ampliar relaciones o contexto cuando proceda.

Revisar paginación. Usar `rg`/`rg --files` para literales, documentación,
configuración/scripts no cubiertos o resultados insuficientes del grafo.
Corroborar afirmaciones importantes en las fuentes del checkout actual.

## Documentación de dependencias

Usar Context7 para cuestiones específicas de bibliotecas, frameworks, SDK,
API externas, CLI o servicios cloud, aunque parezcan conocidos. Resolver primero
la versión real desde el lockfile. Empezar por `resolve-library-id`, salvo ID
exacto proporcionado; elegir por nombre, relevancia, reputación y versión.
Después usar `query-docs` con una pregunta completa sobre un concepto.
Separar conceptos distintos en consultas distintas.

No consultar upstream para un refactor, lógica de negocio o revisión general
que se resuelva con código local. Si Context7 no está disponible o no cubre la
versión, usar fuentes oficiales y declarar el límite.

## Fuentes canónicas y cierre

- Responsabilidades y estado: [arquitectura](docs/architecture/overview.md).
- Autoridad/recuperación: [sincronización](docs/architecture/synchronization.md).
- Payloads, permisos, errores y efectos: [API](docs/api/README.md).
- Comportamiento: `docs/features/`; tareas: `docs/guides/`; entorno: `docs/operations/`.
- Privacidad: `docs/privacy/`; decisiones: `docs/adr/`; pendientes: [TODO](TODO.md).

Actualizar la fuente afectada y sus resúmenes/enlaces. Conservar auditorías y ADR
aceptados como historia; registrar remediaciones aparte. Antes de la primera
publicación no conservar stubs ni anchors de compatibilidad innecesarios.
Inspeccionar scripts/hooks antes de ejecutar checks; utilizar fixtures aislados.
Revisar diff/status y distinguir tests locales de aceptación real del candidato.
No afirmar estabilidad sin cumplir [la guía de release](docs/guides/prepare-release.md).
