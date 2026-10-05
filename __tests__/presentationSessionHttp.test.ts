import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';

const sockets: WebSocket[] = [];
let child: ChildProcess | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  sockets.forEach(ws => ws.terminate()); sockets.length = 0;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill();
    await exited;
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  child = undefined; dataDir = undefined;
});

it('persists HTTP reset before success and fails closed without changing projection when storage fails', async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-http-session-'));
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const address = reserve.address();
  if (!address || typeof address === 'string') throw new Error('TCP address required');
  const port = address.port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  child = spawn(process.execPath, ['server/local-server.mjs'], {
    cwd: process.cwd(), stdio: 'ignore', windowsHide: true,
    env: {
      ...process.env, SEFER_DATA_DIR: dataDir, SEFER_PORT: String(port),
      SEFER_REQUIRE_AUTH: 'false', SEFER_LIVE_AUDIO_ENABLED: 'false', SEFER_VOICE_SCRIPTURE_ENABLED: 'false',
    },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await vi.waitFor(async () => {
    expect(child!.exitCode).toBeNull();
    const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) });
    expect(health.ok).toBe(true);
  }, { timeout: 5_000, interval: 50 });
  const connect = () => new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws?role=control'); sockets.push(ws);
    ws.on('message', raw => { const msg = JSON.parse(raw.toString()); if (msg.type === 'WELCOME') resolve(msg.operatorCredential); });
    ws.on('error', reject);
  });
  let credential = await connect();
  const markerPath = path.join(dataDir, 'presentation-session.json');
  const marker = () => JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { sessionId: string; expiresAt: number };
  const command = (payload: unknown) => fetch(`${baseUrl}/api/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sefer-Operator-Credential': credential },
    body: JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'test-control', payload }),
  });
  const initialId = marker().sessionId;
  const rejected = await command({ command: 'UNKNOWN_COMMAND', clearSession: true });
  expect(rejected.status).toBe(400);
  expect(marker().sessionId).toBe(initialId);
  const accepted = await command({ command: 'RESET_STATE', clearSession: true });
  expect(accepted.status).toBe(200);
  credential = await connect();
  const nextId = marker().sessionId;
  expect(nextId).not.toBe(initialId);
  expect(Object.keys(marker()).sort()).toEqual(['expiresAt', 'sessionId']);
  const projectionBefore = await (await fetch(`${baseUrl}/api/state`)).json();
  // An unwritable backup target makes the existing safe writer reject rotation.
  fs.unlinkSync(`${markerPath}.bak`);
  fs.mkdirSync(`${markerPath}.bak`);
  const failed = await command({ command: 'RESET_STATE', clearSession: true });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({
    code: 'SESSION_PERSISTENCE_FAILED', error: 'Presentation session reset could not be persisted',
  });
  expect(marker().sessionId).toBe(nextId);
  expect(await (await fetch(`${baseUrl}/api/state`)).json()).toEqual(projectionBefore);
}, 10_000);
