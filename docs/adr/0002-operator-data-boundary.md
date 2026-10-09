# 0002 — Separar producto y datos del operador

Estado: decisión implementada; registro retrospectivo.
Redacción: 2026-10-07. Evidencia histórica: 2026-08-25.

## Contexto documentado

[1935ede](https://github.com/CesarJER/SeferPresenter/commit/1935ede264f8b1d93f66736a3bf809fcf5cbfed1)
mueve presentaciones, mapas y configuración de caché a SEFER_DATA_DIR, conserva
datos copiando únicamente archivos ausentes y mantiene persistencia validada.
El commit deja explícitamente los medios para una fase posterior.
[3aa69d4](https://github.com/CesarJER/SeferPresenter/commit/3aa69d4fa292ebf988c165225099ad6a58061289)
documenta la separación completada de branding/activos y elimina excepciones
y ejemplos duplicados.

No se atribuye al primer commit el alcance que completó el posterior.

## Decisión implementada

El repositorio mantiene producto y ejemplos neutrales. Los catálogos, medios,
corpus, branding y configuración de instancia residen en la raíz privada
SEFER_DATA_DIR. El primer arranque rellena ausentes sin sobrescribir existentes.
El generador y runtime utilizan las rutas configuradas.

## Consecuencias: análisis actual

Facilita actualizar código conservando datos de instancia y reduce inclusión
accidental de datos del operador en Git/build. Exige gestionar montaje, permisos,
backups y lifecycle fuera del código. Un archivo fuera de Git puede servirse
públicamente: este límite no acredita confidencialidad ni licencia del corpus.

La persistencia tiene mecanismos de recuperación, pero sus garantías dependen
del filesystem y del recorrido de error; no implica rollback universal.

## Evidencia y relaciones

Fuentes: [data-directory](../../server/data-directory.mjs),
[ejemplo neutral](../../examples/SeferPrivateData/README.md),
[generador](../../scripts/generate-verses.js) y
[tests de datos](../../__tests__/dataDirectory.test.ts).
Procedimiento actual: [operación](../operations/deployment.md).
Tratamiento y límites: [privacidad](../privacy/README.md).
