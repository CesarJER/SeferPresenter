# Codebase Memory Integration (`codebase-memory-mcp`)

SeferPresenter integra el servidor de inteligencia de código [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) para indexar de manera ultra-rápida la estructura del proyecto en un grafo de conocimiento AST local (Tree-Sitter).

## Beneficios para Agentes y Desarrolladores

- **Navegación por Grafo**: Análisis instantáneo de cadenas de llamadas, componentes React, hooks (`useSyncState`, `useAudioSync`) y endpoints de `local-server.mjs`.
- **Análisis de Impacto**: Identifica qué partes de la aplicación dependen de un archivo o función antes de realizar una refactorización.
- **Reducción de consumo de Tokens**: Permite realizar consultas de código precisas consumiendo hasta un 90% menos de contexto que búsquedas secuenciales por archivo.
- **Visualizador 3D UI**: Interfaz visual disponible en `http://localhost:9749` cuando el servidor MCP está activo.

## Re-indexación Manual del Proyecto

Para actualizar o forzar la re-indexación del proyecto SeferPresenter tras realizar cambios significativos en la arquitectura:

```bash
npm run index:memory
```

O directamente mediante CLI:

```bash
codebase-memory-mcp cli index_repository --repo-path . --mode fast
```

## Herramientas MCP disponibles

Los asistentes de IA conectados (Antigravity, Gemini CLI, Codex, etc.) tienen acceso a las siguientes 15 herramientas MCP:

- `index_repository`: Indexa o re-indexa el repositorio.
- `search_graph`: Busca nodos de código (funciones, clases, componentes, variables) en el grafo.
- `trace_path`: Muestra la cadena de llamadas entre dos funciones o archivos.
- `get_architecture`: Devuelve la vista jerárquica y arquitectónica de los componentes.
- `detect_changes`: Analiza qué archivos o funciones han cambiado con respecto al índice.
- `manage_adr`: Registra o actualiza registros de decisiones de arquitectura (ADRs).
