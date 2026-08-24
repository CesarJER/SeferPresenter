import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { restartPwaApp } from '../src/utils/pwaUpdate';

const loadServiceWorkerHelpers = () => {
  const source = readFileSync('public/audience-sw.js', 'utf8');
  const selfMock = {
    location: { origin: 'https://example.test' },
    addEventListener: vi.fn(),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const context = vm.createContext({
    self: selfMock,
    URL,
    Set,
  });

  vm.runInContext(source, context);
  return (selfMock as typeof selfMock & {
    __SEFER_PWA_TESTING__: {
      SW_VERSION: string;
      isNeverCacheUrl: (url: URL) => boolean;
      isLegalUrl: (url: URL) => boolean;
      isMediaUrl: (url: URL) => boolean;
      isImageUrl: (url: URL) => boolean;
      isAudienceShell: (url: URL) => boolean;
      shouldRuntimeCacheUrl: (url: URL) => boolean;
    };
  }).__SEFER_PWA_TESTING__;
};

describe('PWA service worker policy', () => {
  it('exports version 1.3.1 and explicit cache helper decisions', () => {
    const helpers = loadServiceWorkerHelpers();

    expect(helpers.SW_VERSION).toBe('1.3.1');

    [
      '/api/state',
      '/api/state-events',
      '/api/quiz-events',
      '/api/livekit/token',
      '/api/livekit/refresh-token',
      '/ws',
      '/rtc/validate',
      '/twirp/livekit.RoomService/ListRooms',
      '/control?token=abc',
      '/proteccion-datos',
      '/legal/privacy.md',
      '/legal/operator.local/privacy-policy.local.md',
    ].forEach((path) => {
      expect(helpers.isNeverCacheUrl(new URL(path, 'https://example.test'))).toBe(true);
    });

    [
      '/videos/Adoradle.mp4',
      '/backgrounds/Fondos/Nubes.mp4',
      '/audio/music/song.mp3',
    ].forEach((path) => {
      const url = new URL(path, 'https://example.test');
      expect(helpers.isNeverCacheUrl(url)).toBe(false);
      expect(helpers.isMediaUrl(url)).toBe(true);
      expect(helpers.shouldRuntimeCacheUrl(url)).toBe(false);
    });

    expect(helpers.isImageUrl(new URL('/images/background.webp', 'https://example.test'))).toBe(true);
    expect(helpers.isImageUrl(new URL('/assets/slide.png', 'https://example.test'))).toBe(true);

    expect(helpers.isAudienceShell(new URL('/audience', 'https://example.test'))).toBe(true);
    expect(helpers.isAudienceShell(new URL('/control', 'https://example.test'))).toBe(true);
    expect(helpers.isAudienceShell(new URL('/assets/index-abc.js', 'https://example.test'))).toBe(false);
    expect(helpers.isAudienceShell(new URL('/videos/Adoradle.mp4', 'https://example.test'))).toBe(false);
    expect(helpers.isLegalUrl(new URL('/proteccion-datos', 'https://example.test'))).toBe(true);
    expect(helpers.isLegalUrl(new URL('/legal/privacy.md', 'https://example.test'))).toBe(true);
    expect(helpers.shouldRuntimeCacheUrl(new URL('/legal/privacy.md', 'https://example.test'))).toBe(false);
  });

  it('uses network-only no-store handling for legal documents', () => {
    const source = readFileSync('public/audience-sw.js', 'utf8');
    const coreAssets = source.match(/const CORE_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
    expect(source).toContain("if (isLegalUrl(url))");
    expect(source).toContain("fetch(request, { cache: 'no-store' })");
    expect(coreAssets).not.toContain('/legal/');
  });

  it('loads the instance cache list through the uncached public API', () => {
    const source = readFileSync('public/audience-sw.js', 'utf8');
    const coreAssets = source.match(/const CORE_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';

    expect(source).toContain("fetch('/api/audience-cache-assets', { cache: 'no-store' })");
    expect(coreAssets).not.toContain('/audience-cache-assets.txt');
    expect(coreAssets).not.toContain('/api/branding/');
  });
});

describe('PWA manifests', () => {
  it('declares the runtime branding logo for Audience and Control', () => {
    const audienceManifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    const controlManifest = JSON.parse(readFileSync('public/control-manifest.webmanifest', 'utf8'));

    expect(audienceManifest.start_url).toBe('/audience');
    expect(audienceManifest.scope).toBe('/audience');
    expect(controlManifest.start_url).toBe('/control');
    expect(controlManifest.scope).toBe('/control');

    for (const manifest of [audienceManifest, controlManifest]) {
      const iconSrcs = manifest.icons.map((icon: { src: string }) => icon.src);
      expect(iconSrcs).toContain('/api/branding/logo.svg');
      expect(iconSrcs).not.toContain('/logo.svg');
      expect(iconSrcs).not.toContain('/icons/sefer-icon-192.png');
      expect(iconSrcs).not.toContain('/icons/sefer-icon-512.png');
      expect(iconSrcs).not.toContain('/icons/sefer-maskable-512.png');
    }
  });

  it('loads the runtime favicon in every HTML entry point', () => {
    for (const htmlFile of [
      'index.html',
      'presenter.html',
      'audience.html',
      'control.html',
      'audio-editor.html',
      'catalog.html',
    ]) {
      expect(readFileSync(htmlFile, 'utf8')).toContain('href="/api/branding/favicon.svg"');
    }
  });
});

describe('restartPwaApp', () => {
  it('reloads after confirmation without touching localStorage', async () => {
    const reload = vi.fn();
    const confirm = vi.fn(() => true);
    const localStorage = {
      clear: vi.fn(() => { throw new Error('localStorage.clear must not be called'); }),
      removeItem: vi.fn(() => { throw new Error('localStorage.removeItem must not be called'); }),
      setItem: vi.fn(() => { throw new Error('localStorage.setItem must not be called'); }),
    };
    const win = {
      confirm,
      location: { reload },
      localStorage,
    } as unknown as Window;
    const nav = {
      serviceWorker: {
        getRegistration: vi.fn(async () => null),
      },
    } as unknown as Navigator;

    await expect(restartPwaApp({ win, nav })).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledWith('Quieres reiniciar la app?');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.clear).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
