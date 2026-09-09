import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import ffmpegPath from 'ffmpeg-static';
import { WebSocket } from 'ws';

if (existsSync('.env')) process.loadEnvFile('.env');
const withParser = process.argv.includes('--with-parser');
const [audioPath, endpoint = 'ws://127.0.0.1:9090/v1/realtime'] = process.argv.slice(2).filter((arg) => arg !== '--with-parser');
const key = process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY;
if (!audioPath || !key) throw new Error('Indica un WAV y configura SEFER_VOICE_SCRIPTURE_STT_API_KEY en .env');
const converted = spawnSync(ffmpegPath, ['-v', 'error', '-i', resolve(audioPath), '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
if (converted.status !== 0 || !converted.stdout.length) throw new Error('WAV no convertible');
const pcm = converted.stdout;
let parseFinal;
if (withParser) {
  // Compile only the pure parser in memory; do not generate or modify corpus files.
  const ts = await import('typescript');
  const code = ts.transpileModule(readFileSync(new URL('../src/features/voiceScripture/voiceScriptureParser.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { parseVoiceScriptureUtterance } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const metadata = JSON.parse(readFileSync(resolve(process.env.SEFER_DATA_DIR || 'data.local', 'public/metadata.json'), 'utf8'));
  parseFinal = (text) => Boolean(parseVoiceScriptureUtterance(text, null, metadata).automatic);
}
const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${key}` } });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const results = [];
let endedAt = 0;
let failed = false;
const timeout = setTimeout(() => { failed = true; socket.terminate(); }, 60_000);
socket.on('message', (raw) => {
  const event = JSON.parse(raw.toString());
  if (event.type === 'error') failed = true;
  if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) {
    const parsed = parseFinal?.(event.transcript);
    results.push({ finalDelayMs: endedAt ? Math.round(performance.now() - endedAt) : null, textLength: event.transcript.length, parsed });
    if (parsed === false) failed = true;
  }
});
socket.once('error', () => { failed = true; });
socket.once('open', async () => {
  try {
    socket.send(JSON.stringify({ type: 'session.update', session: { sample_rate: 16000, language: 'es-ES', endpointing_ms: 1000 } }));
    for (let attempt = 0; attempt < 3 && !failed; attempt++) {
      endedAt = 0;
      for (let offset = 0; offset < pcm.length; offset += 10240) {
        const chunk = pcm.subarray(offset, offset + 10240);
        socket.send(chunk);
        await pause(chunk.length / 32);
      }
      endedAt = performance.now();
      for (let silence = 0; silence < 10; silence++) { socket.send(Buffer.alloc(10240)); await pause(320); }
      if (results.length !== attempt + 1) { failed = true; break; }
    }
  } catch { failed = true; }
  finally { socket.close(); }
});
socket.once('close', () => {
  clearTimeout(timeout);
  console.log(JSON.stringify({ passed: !failed && results.length === 3, finals: results.length, commitSent: false, results }));
  if (failed || results.length !== 3) process.exitCode = 1;
});
