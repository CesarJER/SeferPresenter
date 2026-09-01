import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import ffmpegPath from 'ffmpeg-static';
import { WebSocket } from 'ws';

const [audioPath, socketUrl = 'ws://127.0.0.1:9090/v1/realtime'] = process.argv.slice(2);
const apiKey = String(process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY || '').trim();
const controlPassword = String(process.env.SEFER_VOICE_SCRIPTURE_CONTROL_PASSWORD || '').trim();

if (!audioPath || (!apiKey && !controlPassword)) {
  console.error('Uso: configura SEFER_VOICE_SCRIPTURE_STT_API_KEY (STT directo) o SEFER_VOICE_SCRIPTURE_CONTROL_PASSWORD (proxy Sefer), y pasa <audio.wav> [ws-url]');
  process.exit(2);
}

const conversion = spawnSync(ffmpegPath, [
  '-v', 'error', '-i', audioPath, '-f', 's16le', '-acodec', 'pcm_s16le',
  '-ac', '1', '-ar', '16000', 'pipe:1',
], { encoding: null, maxBuffer: 32 * 1024 * 1024 });

if (conversion.status !== 0 || !conversion.stdout?.length) {
  console.error(conversion.stderr?.toString() || 'No se pudo convertir el WAV a PCM16 mono 16 kHz');
  process.exit(1);
}

const pcm = conversion.stdout;
const chunkBytes = 16_000 * 2 * 0.32;
let socket;
if (controlPassword) {
  const parsedSocketUrl = new URL(socketUrl);
  const httpOrigin = `${parsedSocketUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${parsedSocketUrl.host}`;
  const authorization = `Basic ${Buffer.from(`control:${controlPassword}`).toString('base64')}`;
  const response = await fetch(`${httpOrigin}/api/voice-scripture/token`, {
    method: 'POST',
    headers: { Authorization: authorization, Origin: httpOrigin },
  });
  const payload = await response.json();
  if (!response.ok || !payload.available || !payload.token) {
    console.error(`El proxy Sefer no emitió capacidad STT (${response.status})`);
    process.exit(1);
  }
  socket = new WebSocket(socketUrl, ['voice-scripture', payload.token], { headers: { Origin: httpOrigin } });
} else {
  socket = new WebSocket(socketUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
}
const startedAt = performance.now();
let audioEndedAt = 0;
let settled = false;

const finish = (error, result) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  socket.close();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result));
};

const timeout = setTimeout(() => finish(new Error('Timeout esperando el resultado final del STT')), 15_000);

socket.once('open', async () => {
  socket.send(JSON.stringify({
    type: 'session.update',
    session: { sample_rate: 16000, language: 'es-ES', automatic_punctuation: true, endpointing_ms: 800 },
  }));

  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    socket.send(pcm.subarray(offset, Math.min(offset + chunkBytes, pcm.length)));
    await new Promise((resolve) => setTimeout(resolve, 320));
  }
  audioEndedAt = performance.now();
  socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
});

socket.on('message', (data, isBinary) => {
  if (isBinary) return;
  try {
    const message = JSON.parse(data.toString());
    if (message.type === 'conversation.item.input_audio_transcription.completed') {
      const completedAt = performance.now();
      finish(null, {
        transcript: message.transcript,
        audioSeconds: pcm.length / 2 / 16_000,
        totalMs: Math.round(completedAt - startedAt),
        finalAfterAudioMs: Math.round(completedAt - audioEndedAt),
      });
    } else if (message.type === 'error') {
      finish(new Error(message.error?.message || 'El STT devolvió un error'));
    }
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
});

socket.once('error', (error) => finish(error));
