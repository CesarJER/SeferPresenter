import { defineConfig } from 'vitest/config'
import type { Plugin, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import type { AudioState } from './src/types/audio'
import type { VideoState } from './src/types/presentation'
import type { DisplayTelemetryState, SyncStatePayload } from './src/types/sync'
import { validateAudioSyncMaps, validatePresentationList, validateSyncMessage } from './src/utils/validation'

type NextFunction = () => void;
type PresentationRecord = {
  background?: string;
};
type ServerSyncState = Partial<SyncStatePayload> & { type?: string };
type AudioTelemetryPayload = { audioState: AudioState };
type VideoTelemetryPayload = { videoState: VideoState | null };
type DisplayTelemetryPayload = DisplayTelemetryState;

const normalizePublicPath = (value: string) => {
  if (!value) return '';

  const normalized = value.replace(/\\/g, '/');
  const publicIndex = normalized.lastIndexOf('/public/');
  if (publicIndex >= 0) {
    return normalized.slice(publicIndex + '/public'.length);
  }

  if (normalized.startsWith('public/')) {
    return `/${normalized.slice('public/'.length)}`;
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const normalizePresentations = (presentations: PresentationRecord[]) =>
  presentations.map(presentation => ({
    ...presentation,
    background: normalizePublicPath(presentation.background || '')
  }));

const parsePresentations = (content: string) =>
  JSON.parse(content.replace(/^\uFEFF/, '')) as PresentationRecord[];

let currentState: ServerSyncState = {
  presentation: null,
  slideIndex: -1,
  backgroundLock: false,
  lockedBackgroundValue: null,
  userSelectedBackground: null
};
let clients: ServerResponse[] = [];

function fileBackendPlugin(): Plugin {
  return {
    name: 'file-backend',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        if (req.url === '/api/state-events' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          res.write(`data: ${JSON.stringify(currentState)}\n\n`);
          clients.push(res);
          req.on('close', () => {
            clients = clients.filter(c => c !== res);
          });
          return;
        }

        if (req.url === '/api/state' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body) as ServerSyncState;
              const validation = validateSyncMessage(parsed);
              if (!validation.ok) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid sync state', details: validation.errors }));
                return;
              }
              currentState = parsed;
              clients.forEach(client => {
                client.write(`data: ${body}\n\n`);
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.url === '/api/audio-telemetry' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const telemetry = JSON.parse(body) as AudioTelemetryPayload;
              const validation = validateSyncMessage(telemetry);
              if (!validation.ok) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid audio telemetry', details: validation.errors }));
                return;
              }
              currentState = {
                ...currentState,
                audioState: telemetry.audioState,
              };
              clients.forEach(client => {
                client.write(`data: ${body}\n\n`);
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.url === '/api/video-telemetry' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const telemetry = JSON.parse(body) as VideoTelemetryPayload;
              const validation = validateSyncMessage(telemetry);
              if (!validation.ok) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid video telemetry', details: validation.errors }));
                return;
              }
              currentState = {
                ...currentState,
                videoState: telemetry.videoState,
              };
              clients.forEach(client => {
                client.write(`data: ${body}\n\n`);
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.url === '/api/display-telemetry' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const telemetry = JSON.parse(body) as DisplayTelemetryPayload;
              const validation = validateSyncMessage(telemetry);
              if (!validation.ok) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid display telemetry', details: validation.errors }));
                return;
              }
              currentState = {
                ...currentState,
                backgroundLock: telemetry.backgroundLock,
                lockedBackgroundValue: telemetry.lockedBackgroundValue,
                userSelectedBackground: telemetry.userSelectedBackground,
              };
              clients.forEach(client => {
                client.write(`data: ${body}\n\n`);
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.url === '/api/backgrounds' && req.method === 'GET') {
          const bgDir = path.resolve(__dirname, 'public/backgrounds');
          const videoDir = path.resolve(__dirname, 'public/videos');

          if (!fs.existsSync(videoDir)) {
            fs.mkdirSync(videoDir, { recursive: true });
          }

          const results: string[] = [];

          const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const list = fs.readdirSync(dir);
            list.forEach((file) => {
              const fullPath = path.join(dir, file);
              const stat = fs.statSync(fullPath);
              if (stat && stat.isDirectory()) {
                walk(fullPath);
              } else {
                if (fullPath.match(/\.(png|jpe?g|mp4|webm)$/i)) {
                  // Use path.relative to get the path from public folder
                  const relPath = path.relative(path.resolve(__dirname, 'public'), fullPath);
                  results.push('/' + relPath.replace(/\\/g, '/'));
                }
              }
            });
          };

          walk(bgDir);
          walk(videoDir);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(results.map(r => r.startsWith('/') ? r : '/' + r)));
          return;
        }

        if (req.url === '/api/audio' && req.method === 'GET') {
          const audioDir = path.resolve(__dirname, 'public/audio');

          if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
          }

          const audioResults: string[] = [];

          const walkAudio = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const list = fs.readdirSync(dir);
            list.forEach((file) => {
              const fullPath = path.join(dir, file);
              const stat = fs.statSync(fullPath);
              if (stat && stat.isDirectory()) {
                walkAudio(fullPath);
              } else {
                if (fullPath.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i)) {
                  const relPath = path.relative(path.resolve(__dirname, 'public'), fullPath);
                  audioResults.push('/' + relPath.replace(/\\/g, '/'));
                }
              }
            });
          };

          walkAudio(audioDir);
          // Walk audio and music folders (only one music folder needed; Windows FS is case-insensitive)

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(audioResults));
          return;
        }

        if (req.url === '/api/audio-sync' && req.method === 'GET') {
          const syncPath = path.resolve(__dirname, 'audio_sync.json');
          if (fs.existsSync(syncPath)) {
            try {
              const content = fs.readFileSync(syncPath, 'utf-8').replace(/^\uFEFF/, '');
              const validation = validateAudioSyncMaps(JSON.parse(content));
              if (!validation.ok) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid audio sync file', details: validation.errors }));
                return;
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(validation.value));
            } catch {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid audio sync JSON' }));
            }
          } else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
          }
          return;
        }

        if (req.url === '/api/audio-sync' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const syncPath = path.resolve(__dirname, 'audio_sync.json');
              const parsed = JSON.parse(body);
              const validation = validateAudioSyncMaps(parsed);
              if (!validation.ok) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid audio sync maps', details: validation.errors }));
                return;
              }
              fs.writeFileSync(syncPath, JSON.stringify(validation.value, null, 2), 'utf-8');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.url === '/api/presentations' && req.method === 'GET') {
          const pPath = path.resolve(__dirname, 'presentations.json');
          if (fs.existsSync(pPath)) {
            try {
              const presentations = parsePresentations(fs.readFileSync(pPath, 'utf-8'));
              const validation = validatePresentationList(presentations);
              if (!validation.ok || !validation.value) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid presentations file', details: validation.errors }));
                return;
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(normalizePresentations(validation.value)));
            } catch {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid presentations JSON' }));
            }
          } else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
          }
          return;
        }

        if (req.url === '/api/presentations' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const pPath = path.resolve(__dirname, 'presentations.json');
              const presentations = parsePresentations(body);
              const validation = validatePresentationList(presentations);
              if (!validation.ok || !validation.value) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid presentations', details: validation.errors }));
                return;
              }
              fs.writeFileSync(pPath, JSON.stringify(normalizePresentations(validation.value)), 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        next();
      });
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_MODE__: JSON.stringify(process.env.VITE_APP_MODE ?? 'web'),
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  plugins: [
    react(),
    fileBackendPlugin(),
    process.env.VITE_APP_MODE === 'singlefile' ? viteSingleFile() : null
  ].filter(Boolean),
  base: './',
})
