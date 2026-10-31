import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { getSeferDataPaths, resolveSeferDataDir } from '../server/data-directory.mjs';
import { writeJsonSafely } from '../server/json-persistence.mjs';
import { createPresentationSessionStore, PRESENTATION_SESSION_TTL_MS } from '../server/presentation-session.mjs';
import { createWsServer, resetWsServerStateForTests } from '../server/ws-server.mjs';
import { readActivePresentationSession, seedPresentationSessionFromBackend } from '../scripts/seed-presentation-session.mjs';

type Message = Record<string, unknown> & { type: string };
let dataDir: string;
let filePath: string;
let httpServer: Server | undefined;
let wss: WebSocketServer | undefined;
let clients: WebSocket[] = [];
let url: string;

const connect = async (role: 'control' | 'audience') => {
  const ws = new WebSocket(`${url}?role=${role}`);
  clients.push(ws);
  const messages: Message[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const waitFor = (predicate: (message: Message) => boolean) => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => { ws.off('message', handler); reject(new Error('WebSocket message timeout')); }, 1000);
      const handler = (raw: WebSocket.RawData) => {
        const message = JSON.parse(raw.toString()) as Message;
        if (!predicate(message)) return;
        clearTimeout(timer); ws.off('message', handler); resolve(message);
      };
      ws.on('message', handler);
    });
  };
  return { ws, messages, waitFor };
};

const startWs = async (store: ReturnType<typeof createPresentationSessionStore>, fallback?: (message: unknown, meta: unknown, beforeReset: () => void) => boolean) => {
  httpServer = createServer();
  wss = createWsServer(httpServer, fallback, { presentationSessionStore: store });
  await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('TCP address required');
  url = `ws://127.0.0.1:${address.port}/ws`;
};

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-presentation-session-'));
  vi.stubEnv('SEFER_DATA_DIR', dataDir);
  vi.stubEnv('SEFER_REQUIRE_AUTH', 'false');
  filePath = getSeferDataPaths(resolveSeferDataDir({ rootDir: process.cwd() })).presentationSession;
  resetWsServerStateForTests();
});

it('exposes only a valid expired session for bounded startup room cleanup', () => {
  const now = 2 * PRESENTATION_SESSION_TTL_MS;
  const original = createPresentationSessionStore({ filePath, now: () => 0 });
  const restarted = createPresentationSessionStore({ filePath, now: () => now });
  expect(restarted.getSessionId()).not.toBe(original.getSessionId());
  expect(restarted.getRetiredSessionId()).toBe(original.getSessionId());
  const warmRestart = createPresentationSessionStore({ filePath, now: () => now });
  expect(warmRestart.getSessionId()).toBe(restarted.getSessionId());
  expect(warmRestart.getRetiredSessionId()).toBeUndefined();
});

afterEach(async () => {
  clients.forEach((client) => client.terminate());
  clients = [];
  if (wss) await new Promise<void>((resolve) => wss!.close(() => resolve()));
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  wss = undefined; httpServer = undefined;
  resetWsServerStateForTests();
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('private presentation session marker', () => {
  it('stores only the technical UUID and a 24 hour expiry in the private root', () => {
    const now = 1_000_000;
    const store = createPresentationSessionStore({ filePath, now: () => now });
    expect(path.dirname(filePath)).toBe(dataDir);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      sessionId: store.getSessionId(), expiresAt: now + PRESENTATION_SESSION_TTL_MS,
    });
    expect(store.getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the marker after a restart without extending its original TTL', () => {
    const now = 1_000_000;
    const first = createPresentationSessionStore({ filePath, now: () => now });
    const before = fs.readFileSync(filePath, 'utf8');
    const restarted = createPresentationSessionStore({ filePath, now: () => now + 60_000 });
    expect(restarted.getSessionId()).toBe(first.getSessionId());
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });

  it('creates a new boundary once the persisted TTL expires', () => {
    const first = createPresentationSessionStore({ filePath, now: () => 1_000_000 });
    const restarted = createPresentationSessionStore({ filePath, now: () => 1_000_000 + PRESENTATION_SESSION_TTL_MS });
    expect(restarted.getSessionId()).not.toBe(first.getSessionId());
  });

  it.each(['invalid json', JSON.stringify({ sessionId: 'wrong', expiresAt: 2_000_000 }), JSON.stringify({ sessionId: '6f647efe-e2f0-4e6a-bc01-cb8f5f9a5365', expiresAt: 2_000_000, alias: 'forbidden' })])('replaces an invalid marker with exactly the permitted fields', (contents) => {
    fs.writeFileSync(filePath, contents);
    createPresentationSessionStore({ filePath, now: () => 1_000_000 });
    expect(Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf8'))).sort()).toEqual(['expiresAt', 'sessionId']);
  });

  it('keeps its previous in-memory and persisted boundary when rotation fails', () => {
    const write = vi.fn(writeJsonSafely);
    const store = createPresentationSessionStore({ filePath, write });
    const previousId = store.getSessionId();
    const before = fs.readFileSync(filePath, 'utf8');
    write.mockImplementationOnce(() => { throw new Error('private path must not be reported'); });
    expect(() => store.rotate()).toThrow();
    expect(store.getSessionId()).toBe(previousId);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });

  it('accepts an explicit UUID seed only when no valid private marker exists', () => {
    const seededId = '6f647efe-e2f0-4e6a-bc01-cb8f5f9a5365';
    const store = createPresentationSessionStore({ filePath, initialSessionId: seededId });
    expect(store.getSessionId()).toBe(seededId);
    const existing = fs.readFileSync(filePath, 'utf8');
    expect(createPresentationSessionStore({ filePath, initialSessionId: '68daaf40-a5b4-497d-a07c-a1d96f3e4c2c' }).getSessionId()).toBe(seededId);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(existing);
  });
});

describe('WebSocket session reset boundary', () => {
  it('publishes the restored marker in WELCOME after application restart', async () => {
    const first = createPresentationSessionStore({ filePath });
    const restarted = createPresentationSessionStore({ filePath });
    await startWs(restarted);
    const audience = await connect('audience');
    expect((await audience.waitFor((message) => message.type === 'WELCOME')).presentationSessionId).toBe(first.getSessionId());
  });

  it('persists RESET once before projection effects and offline audiences see the new ID in WELCOME', async () => {
    const store = createPresentationSessionStore({ filePath });
    const previousId = store.getSessionId();
    const fallback = vi.fn((_message, _meta, beforeReset) => {
      beforeReset();
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).sessionId).toBe(store.getSessionId());
      expect(store.getSessionId()).not.toBe(previousId);
      return true;
    });
    await startWs(store, fallback);
    const control = await connect('control');
    const offline = await connect('audience');
    const previousWelcome = await offline.waitFor((message) => message.type === 'WELCOME');
    offline.ws.terminate();
    control.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'control', payload: { command: 'RESET_STATE', clearSession: true } }));
    const rotated = await control.waitFor((message) => message.type === 'PRESENTATION_SESSION_ROTATED');
    const returned = await connect('audience');
    const nextWelcome = await returned.waitFor((message) => message.type === 'WELCOME');
    expect(nextWelcome.presentationSessionId).toBe(rotated.presentationSessionId);
    expect(nextWelcome.presentationSessionId).not.toBe(previousWelcome.presentationSessionId);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).sessionId).toBe(nextWelcome.presentationSessionId);
    expect(control.messages.filter((message) => message.type === 'PRESENTATION_SESSION_ROTATED')).toHaveLength(1);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('fails closed with a sanitized error before resetting or broadcasting', async () => {
    const write = vi.fn(writeJsonSafely);
    const store = createPresentationSessionStore({ filePath, write });
    const previousId = store.getSessionId();
    const projectionEffect = vi.fn();
    const fallback = (_message: unknown, _meta: unknown, beforeReset: () => void) => { beforeReset(); projectionEffect(); return true; };
    await startWs(store, fallback);
    const control = await connect('control');
    write.mockImplementationOnce(() => { throw new Error('secret path or identity'); });
    control.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'control', payload: { command: 'RESET_STATE', clearSession: true } }));
    const error = await control.waitFor((message) => message.type === 'ERROR');
    expect(error.code).toBe('SESSION_PERSISTENCE_FAILED');
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(projectionEffect).not.toHaveBeenCalled();
    expect(store.getSessionId()).toBe(previousId);
    expect(control.messages.some((message) => message.type === 'PRESENTATION_SESSION_ROTATED')).toBe(false);
  });

  it('does not rotate a rejected reset command', async () => {
    const store = createPresentationSessionStore({ filePath });
    const previousId = store.getSessionId();
    const fallback = vi.fn(() => false);
    await startWs(store, fallback);
    const control = await connect('control');
    control.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'control', payload: { command: 'RESET_STATE', clearSession: true } }));
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledOnce());
    expect(store.getSessionId()).toBe(previousId);
    expect(control.messages.some((message) => message.type === 'PRESENTATION_SESSION_ROTATED')).toBe(false);
  });

  it('seeds the first upgrade from the active backend WELCOME without audience data', async () => {
    const active = createPresentationSessionStore({ filePath: path.join(dataDir, 'active-marker.json') });
    await startWs(active);
    expect(await seedPresentationSessionFromBackend({ url, dataDir })).toBe(active.getSessionId());
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).sessionId).toBe(active.getSessionId());
    expect(Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf8'))).sort()).toEqual(['expiresAt', 'sessionId']);
  });

  it('does not overwrite a valid marker even when the running backend has a different ID', async () => {
    const existing = createPresentationSessionStore({ filePath });
    const previous = fs.readFileSync(filePath, 'utf8');
    const active = createPresentationSessionStore({ filePath: path.join(dataDir, 'active-marker.json') });
    await startWs(active);
    await expect(seedPresentationSessionFromBackend({ url, dataDir })).rejects.toThrow('differs from the active backend');
    expect(createPresentationSessionStore({ filePath }).getSessionId()).toBe(existing.getSessionId());
    expect(fs.readFileSync(filePath, 'utf8')).toBe(previous);
  });

  it('rejects a migration handshake against a nonlocal backend', () => {
    expect(() => readActivePresentationSession('wss://remote.example/ws')).toThrow('local backend');
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
