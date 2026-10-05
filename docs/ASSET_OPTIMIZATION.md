# Optimización modular de medios

El optimizador reduce tamaño de imágenes PNG en backgrounds/videos y vídeos MP4 mayores de 15 MiB. Mantiene WebP de calidad 80, ancho máximo 1920 y vídeo H.264 720p con AAC; intenta NVENC y usa CPU si falla. Solo reemplaza un archivo cuando reduce su tamaño.

## Uso

- npm run optimize: optimiza imágenes y vídeos.
- npm run optimize:images: solo imágenes y sus referencias.
- npm run optimize:videos: solo vídeos.
- npm run optimize:preview: muestra candidatos sin escribir archivos, crear backups ni ejecutar FFmpeg.
- npm run optimize -- --data-dir "RUTA": usa una carpeta de datos concreta.
- npm run optimize -- --no-backup: evita copias nuevas en legacy; conserva el índice y la detección de cambios.

El comando deploy conserva la optimización previa a la generación y despliegue. Se requieren Python y Pillow para transformar imágenes, y el binario ffmpeg-static instalado por npm para transformar vídeos. Importar el módulo no optimiza archivos ni cambia variables de entorno; AssetOptimizer permite invocar cada etapa por separado.

La carpeta tiene prioridad: argumento --data-dir, SEFER_DATA_DIR del proceso, .env.local, .env y valor por defecto. Una carpeta explícita sin public produce error; no se optimiza silenciosamente otra carpeta.

## Índice de texto independiente de legacy

DATA_DIR/asset-optimization.txt contiene JSON legible: versión, URL relativa, SHA-256 del contenido resultante y preset utilizado. Las entradas se escriben de forma atómica. Está fuera de public; no incluye claves ni datos de participantes.

Cuando contenido y preset coinciden, se omite la conversión sin consultar legacy. Borrar un backup no provoca otra compresión. Si cambia el contenido, se vuelve a evaluar; si cambian los ajustes, debe cambiar el identificador del preset en el script. Un resultado que no reduce tamaño también se registra para no repetir trabajo inútil. El índice crece con el número de archivos, no con su tamaño.

Un índice malformado detiene la ejecución conservando archivos e índice. No lo borres como rutina: perder el registro puede provocar otra compresión de vídeos ya procesados. Los archivos optimizados antes de disponer del índice no tienen una prueba retrospectiva en él; no se marcan solo por su extensión o por encontrar un backup.

Las copias de seguridad son independientes y se conservan por defecto; no se sobrescribe una copia original existente. --no-backup permite operar sin ellas. El script no elimina archivos legacy existentes.

Las imágenes conservan el PNG hasta confirmar la actualización de presentations.json. Si falla el catálogo, el siguiente intento reutiliza el WebP indexado de la misma fuente sin comprimirlo otra vez. Un WebP previo que no coincide con el índice se conserva y se informa; no se sobrescribe de forma silenciosa.

## Validación

__tests__/optimize_assets_test.py usa únicamente medios sintéticos temporales. Comprueba vista previa sin escrituras, índice sin legacy, modificación de contenido, ausencia de reducción, fallo al persistir el índice, índice inválido y recuperación tras un fallo de catálogo. La compresión de vídeo se simula; la conversión PNG/WebP usa Pillow real. No se ejecutó optimización sobre archivos del operador ni se ejecutó deploy.
