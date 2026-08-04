import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('privacy logging configuration', () => {
  it('uses bounded compressed Docker-local logs', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toMatch(/driver:\s*local/);
    expect(compose).toMatch(/max-size:\s*"5m"/);
    expect(compose).toMatch(/max-file:\s*"3"/);
    expect(compose).toMatch(/compress:\s*"true"/);
    expect(compose).toMatch(/LIVEKIT_LOGGING_LEVEL=\$\{LIVEKIT_LOGGING_LEVEL:-warn\}/);
    for (const service of ['caddy', 'redis', 'livekit']) {
      const serviceBlock = compose.match(new RegExp(`\\n  ${service}:([\\s\\S]*?)(?=\\n  [a-z][a-z0-9_-]*:|\\nvolumes:)`))?.[1] || '';
      expect(serviceBlock).toMatch(/logging:\s*\*no-logging/);
    }
  });

  it('does not forward client IP headers to Node or LiveKit', () => {
    const caddy = read('Caddyfile');
    expect(caddy).not.toMatch(/header_up\s+X-(?:Real-IP|Forwarded-For)\s+\{remote/);
    expect(caddy.match(/header_up\s+-X-Real-IP/g)?.length).toBe(3);
    expect(caddy.match(/header_up\s+-X-Forwarded-For/g)?.length).toBe(3);
    expect(caddy).not.toMatch(/^\s*log\s*(?:\{|$)/m);
  });

  it('rotates by safe Compose recreation without direct log-file deletion', () => {
    const rotation = read('scripts/rotate-docker-logs.ps1');
    expect(rotation).toContain('--force-recreate');
    expect(rotation).toContain('ValidateRange(1, 167)');
    expect(rotation).not.toMatch(/Remove-Item|Clear-Content|\/var\/lib\/docker/i);
  });

  it('uses the supported LiveKit root health endpoint', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toContain('http://127.0.0.1:7880/');
    expect(compose).not.toContain('http://127.0.0.1:7880/alive');
  });

  it('keeps server-IP discovery explicit, HTTPS-only and fail-closed', () => {
    const compose = read('docker-compose.yml');
    const example = read('.env.example');
    expect(compose).toContain('LIVEKIT_NODE_IP_AUTO_DETECT=${LIVEKIT_NODE_IP_AUTO_DETECT:-false}');
    expect(example).toContain('LIVEKIT_NODE_IP_AUTO_DETECT=false');
    expect(compose).toContain('https://api.ipify.org');
    expect(compose).toContain('https://icanhazip.com');
    expect(compose).not.toMatch(/http:\/\/(?:api\.ipify\.org|icanhazip\.com|ifconfig\.me)/);
    expect(compose).toContain('LIVEKIT_NODE_IP is required unless LIVEKIT_NODE_IP_AUTO_DETECT=true');
    expect(compose).toContain('LIVEKIT_NODE_IP is not a valid IPv4 address');
  });

  it('does not read request IP or user-agent fields in product server code', () => {
    const serverFiles = ['server/local-server.mjs', 'server/ws-server.mjs', 'server/livekit-server.mjs'];
    const serverSource = serverFiles.map(read).join('\n');
    expect(serverSource).not.toMatch(/remoteAddress|x-forwarded-for|x-real-ip|user-agent/i);
  });

  it('mounts recording manifests only from the ignored local privacy root', () => {
    const compose = read('docker-compose.yml');
    const ignore = read('.gitignore');
    expect(compose).toContain('SEFER_PRIVACY_MANIFEST_DIR=/app/privacy-manifests');
    expect(compose).toContain('${SEFER_PRIVACY_LOCAL_PATH:-./privacy-audit.local}/session-manifests.local:/app/privacy-manifests');
    expect(ignore).toMatch(/\.local/);
    expect(compose).not.toMatch(/privacy-manifests.*public\/legal/);
  });
});
