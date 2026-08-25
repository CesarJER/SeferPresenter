import { afterEach, describe, expect, it } from 'vitest';
import {
  hasAllowedRequestOrigin,
  isProtectedRequestPath,
  isPublicApiRequest,
} from '../server/authUtils.mjs';

const request = (
  headers: Record<string, string>,
  encrypted = false,
) => ({ headers, socket: { encrypted } });

describe('server HTTP security policy', () => {
  afterEach(() => {
    delete process.env.SEFER_REQUIRE_AUTH;
    delete process.env.SEFER_ALLOWED_ORIGINS;
  });

  it('requires authentication by default when the variable is absent', () => {
    delete process.env.SEFER_REQUIRE_AUTH;
    expect(isProtectedRequestPath('/api/presentations', 'GET')).toBe(true);
    expect(isProtectedRequestPath('/control', 'GET')).toBe(true);
  });

  it.each([
    ['GET', '/api/audience/state', false],
    ['GET', '/api/audience/events', false],
    ['GET', '/api/quiz-events', false],
    ['GET', '/api/quiz-control-events', true],
    ['GET', '/api/public-catalogs', false],
    ['GET', '/api/public-catalogs/main/presentations', false],
    ['GET', '/api/public-catalogs/main/presentations/pres-1', false],
    ['GET', '/api/audience-cache-assets', false],
    ['GET', '/api/branding/logo.svg', false],
    ['GET', '/api/branding/favicon.svg', false],
    ['GET', '/api/branding/welcome.md', false],
    ['GET', '/api/legal/manifest', false],
    ['POST', '/api/quiz-answer', false],
    ['GET', '/api/livekit/status', false],
    ['POST', '/api/livekit/token', false],
    ['GET', '/api/state', true],
    ['GET', '/api/state-events', true],
    ['GET', '/api/presentations', true],
    ['GET', '/api/audio-sync', true],
    ['GET', '/api/audio', true],
    ['GET', '/api/backgrounds', true],
    ['POST', '/api/state', true],
    ['POST', '/api/command', true],
  ])('%s %s protected=%s when auth is enabled', (method, pathname, expected) => {
    process.env.SEFER_REQUIRE_AUTH = 'true';
    expect(isProtectedRequestPath(pathname, method)).toBe(expected);
  });

  it('does not protect any path when authentication is disabled', () => {
    process.env.SEFER_REQUIRE_AUTH = 'false';
    expect(isProtectedRequestPath('/api/presentations', 'GET')).toBe(false);
    expect(isProtectedRequestPath('/api/state', 'POST')).toBe(false);
  });

  it('uses an exact public catalog route allowlist', () => {
    expect(isPublicApiRequest('/api/public-catalogs/main/presentations/pres-1', 'GET')).toBe(true);
    expect(isPublicApiRequest('/api/public-catalogs/main/presentations/pres-1/private', 'GET')).toBe(false);
    expect(isPublicApiRequest('/api/public-catalogs-extra', 'GET')).toBe(false);
  });

  it('accepts same-origin and proxy-aware origins and rejects cross-origin requests', () => {
    expect(hasAllowedRequestOrigin(request({ host: 'localhost:8787', origin: 'http://localhost:8787' }))).toBe(true);
    expect(hasAllowedRequestOrigin(request({
      host: 'app:8787',
      origin: 'https://live.example.test',
      'x-forwarded-host': 'live.example.test',
      'x-forwarded-proto': 'https',
    }))).toBe(true);
    expect(hasAllowedRequestOrigin(request({ host: 'localhost:8787', origin: 'https://evil.example' }))).toBe(false);
    expect(hasAllowedRequestOrigin(request({ host: 'localhost:8787' }))).toBe(true);
  });

  it('honors the configured origin allowlist', () => {
    process.env.SEFER_ALLOWED_ORIGINS = 'https://control.example, https://backup.example';
    expect(hasAllowedRequestOrigin(request({ host: 'internal:8787', origin: 'https://control.example' }))).toBe(true);
    expect(hasAllowedRequestOrigin(request({ host: 'internal:8787', origin: 'https://evil.example' }))).toBe(false);
  });
});
