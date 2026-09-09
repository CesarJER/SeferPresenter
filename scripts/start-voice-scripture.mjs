import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const engine = resolve(option('--engine', resolve(root, '../STT_Engine/bin/nemo-speech.exe')));
const model = resolve(option('--model', resolve(root, '../STT_Engine/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf')));
const host = option('--host', '127.0.0.1');
const port = Number(option('--port', '9090'));
const key = process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY;
if (!key || !existsSync(engine) || !existsSync(model) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Falta clave local, ejecutable, modelo o puerto válido. Configura .env y/o --engine, --model, --port.');
  process.exit(2);
}
const version = spawnSync(engine, ['--version'], { encoding: 'utf8', windowsHide: true });
if (version.status !== 0 || !/nemo-speech 0\.1\.0\b/.test(version.stdout)) {
  console.error('Este arranque está validado para NeMo-Speech.cpp 0.1.0; verifica el protocolo antes de cambiar de versión.');
  process.exit(2);
}
// Refuse duplicate listeners. No unrelated process is killed by this launcher.
const probe = net.createServer();
await new Promise((resolveProbe, reject) => {
  probe.once('error', reject);
  probe.listen({ host, port, exclusive: true }, () => probe.close(resolveProbe));
}).catch(() => {
  console.error(`Puerto ${port} ocupado; detén el proceso STT anterior antes de iniciar.`);
  process.exit(2);
});
console.log(`NeMo 0.1.0: endpointing activo, silencio 1000 ms, puerto ${port}.`);
const child = spawn(engine, ['serve', '--asr-model', model, '--endpointing', '--stop-history-eou-ms', '1000',
  '--host', host, '--port', String(port), '--api-key', key, '--no-ui'], { stdio: 'inherit', windowsHide: true });
child.once('error', () => { console.error('No se pudo iniciar el motor STT'); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
process.once('SIGINT', () => child.kill());
process.once('SIGTERM', () => child.kill());
