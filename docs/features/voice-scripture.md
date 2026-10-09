# Voice Scripture

Navegación opcional por referencias habladas, usando una fuente local/remota ya
disponible en Live Audio y un motor STT local instalado por el operador.
Solo el Control principal transcribe y proyecta. Los secundarios autorizados
pueden seleccionar fuente y recibir sugerencias privadas. Presenter y Audience
no realizan reconocimiento.

Configuración e instalación: [operación](../operations/deployment.md#voice-scripture).
Interfaces: [HTTP](../api/http.md#voice-scripture) y
[WS dedicado](../api/realtime.md#voice-scripture-ws-dedicado).
Decisiones y medidas antiguas: [registro histórico](../audits/2026-10-07/voice-scripture-historical-notes.md).

## Fuente, interpretación y proyección

Pulsar el micrófono activo junto al nombre selecciona una fuente; otro cambia la
selección y volver a pulsar la elegida la desactiva. El aro amarillo indica
selección. Publicar/silenciar micrófono es otra acción. La selección comienza
vacía y no se restaura desde almacenamiento.

La selección viaja entre Controls mediante VOICE_SOURCE_SELECTION cifrado.
La escucha comienza en el principal cuando dispone de la pista seleccionada.
PCM mono 16 kHz pasa al gateway STT dedicado; el parser valida finales contra
metadatos del corpus y utiliza SCRIPTURE_PROJECT existente. La referencia
absoluta resuelta llega al backend y a displays mediante SYNC_STATE.

El componente permanece montado fuera de inbox/drawers. Las sugerencias aparecen
junto al lector manual, a la derecha en horizontal y debajo en vertical; mover
u ocultar el portal no recrea la sesión.

La última intervención válida sustituye alternativas manuales. Varias referencias
válidas ofrecen todos los botones y proyectan la última. Una mención ambigua o
inválida impide selección automática de esa intervención; las alternativas
válidas siguen disponibles. Habla sin referencias conserva las opciones previas.
Parar borra opciones y cancela hidratación; finales durante stop no proyectan.

Un rango conserva ambos extremos y muestra el primero. Comandos relativos usan
el último contexto confirmado por backend; se abstienen durante una proyección
sin ACK. Si cambia el contexto durante hidratación, se descarta el resultado.

## Parsing y límites actuales

Los nombres y aliases provienen exclusivamente del corpus instalado. Se aceptan
libro/capítulo/versículo y rangos dentro de discurso, números escritos y dígitos
compactos unívocos. Números romanos solo en el sufijo numérico de libro explícito.
También se acepta referencia antes de libro, si el corpus valida ambos.
Abreviaturas espaciadas de libros numerados requieren prueba específica; no se
presupone soporte. Capítulos solos y números aislados no navegan.

Ejemplos sintéticos, condicionados a metadata válida:
- «Alfa dos V»: 2:5.
- «Alfa uno tres al cinco»: conserva 1:3–5.
- «Alfa dos cinco, perdón, dos seis»: corrige a 2:6.
- «No vayamos a Alfa dos cinco»: se abstiene.
- «Alfa uno tres y Beta seis cuatro»: proyecta la última y conserva alternativas.

Correcciones simples: perdón/corrijo/rectifico. Negación es conservadora, no
comprensión general del lenguaje. Con contexto confirmado se admiten próximo/
anterior versículo o capítulo, ahora el N, versículo N, del N al N, continúa
hasta N, volvamos al N y ahora capítulo N V. Aliases ambiguos se rechazan.
Solo finales completos pueden navegar; más de 100 tokens o 1600 caracteres
se rechazan.

## Responsabilidades y cotas

| Unidad / condición | Comportamiento |
| --- | --- |
| VoiceScriptureControl | Cancelación de hidratación, serialización y comprobación de snapshot confirmado |
| voiceScriptureSession | Capacidad/socket/pista/worklet, deduplicación de 512 finales, health y rotación |
| voicePcmWorklet | Mezcla, FIR normalizado de 63 taps, resampling, frames de 320 ms y flush antes del commit manual |
| Parser/projection | Parsing puro, hidratación de corpus y contexto; sin dependencia LiveKit dentro del parser |
| Inicio de audio | Watchdog de 15 s |
| Hidratación o ACK | Timeout de 3 s; ACK perdido detiene automatización, sin reenviar candidato incierto |
| Fuente perdida/mutada o nueva pista bajo misma identidad | Cancela trabajo antiguo; puede iniciar sesión nueva con fuente disponible |
| Sin PCM durante 4 s | Falla; fuente viva seleccionada reintenta a los 5 s; deselección cancela retry |
| Tras primer partial, sin texto/final 4 s o sin final 20 s | Suspende interpretación; descarta acumulado hasta frontera limpia |
| Colas cliente/gateway | 256 KiB; exceso detiene, no descarta habla silenciosamente |
| PCM acumulado | Rotación a próxima intervención completa tras 256 MiB; stop a 448 MiB sin frontera |
| STT indisponible | Consulta estado de nuevo cada 10 s sin recargar Control |

Los reintentos no abren un micrófono. Silencio sin hipótesis parcial no exige un
evento de transcripción. Cambiar contexto, parar o desmontar cancela trabajo.

## Opcionalidad y tratamiento de datos

Build requiere los dos flags VITE_SEFER_LIVE_AUDIO_BUILD y
VITE_SEFER_VOICE_SCRIPTURE_BUILD; runtime requiere Live Audio/Voice habilitados
y configuración STT/contraseña válida. Modelo y GPU no se instalan en el build
base. No se incorpora fallback cloud, LLM, diarización ni grabación.

PCM y transcripciones se procesan en memoria y no entran al socket sync principal,
snapshot de presentación ni base de datos del producto. Sugerencias transitorias
se comparten privadamente entre Controls autorizados. El modo explícito
SEFER_VOICE_SCRIPTURE_DEBUG puede imprimir texto upstream y aliases privados;
el runtime puede conservar esa salida. Mantenerlo apagado en uso normal y revisar
[privacidad](../privacy/technical-privacy-specification.md).

## Evidencia y propuestas

Los registros del 2026-09-09 son evidencia fechada de muestras/pilotos concretos,
no una certificación vigente de precisión o latencia. Siguen siendo necesarias
pruebas representativas, multi-dispositivo y sostenidas para una
[release estable](../guides/prepare-release.md).

Los comandos de voz adicionales, comparación de motores y mediciones pendientes
están en [TODO](../../TODO.md#voice-scripture-propuestas). No son comportamiento
implementado por esta página.
