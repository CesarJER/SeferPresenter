import { defineConfig } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'

type NextFunction = () => void;
type PresentationRecord = {
  background?: string;
  [key: string]: unknown;
};

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

let currentState: any = {
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
              currentState = JSON.parse(body);
              clients.forEach(client => {
                client.write(`data: ${body}\n\n`);
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
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
        
        if (req.url === '/api/presentations' && req.method === 'GET') {
          const pPath = path.resolve(__dirname, 'presentations.json');
          if (fs.existsSync(pPath)) {
            const presentations = parsePresentations(fs.readFileSync(pPath, 'utf-8'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(normalizePresentations(presentations)));
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
            const pPath = path.resolve(__dirname, 'presentations.json');
            const presentations = parsePresentations(body);
            fs.writeFileSync(pPath, JSON.stringify(normalizePresentations(presentations)), 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
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
  plugins: [
    react(),
    fileBackendPlugin(),
    process.env.VITE_APP_MODE === 'singlefile' ? viteSingleFile() : null
  ].filter(Boolean),
  base: './',
})
