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
      isMediaUrl: (url: URL) => boolean;
      isImageUrl: (url: URL) => boolean;
      isAudienceShell: (url: URL) => boolean;
      shouldRuntimeCacheUrl: (url: URL) => boolean;
    };
  }).__SEFER_PWA_TESTING__;
};

describe('PWA service worker policy', () => {
  it('exports a development version and explicit cache helper decisions', () => {
    const source = readFileSync('public/audience-sw.js', 'utf8');
    const helpers = loadServiceWorkerHelpers();

    expect(helpers.SW_VERSION).toBe('dev');
    expect(source).not.toContain('cacheConfiguredAssets().then(() => self.skipWaiting())');
    expect(source).toContain("event.data?.type === 'SKIP_WAITING'");

    [
      '/api/state',
      '/api/state-events',
      '/api/quiz-events',
      '/api/livekit/token',
      '/api/livekit/refresh-token',
      '/api/audience/access/bootstrap',
      '/api/audience/events?ticket=short-lived',
      '/ws',
      '/rtc/validate',
      '/twirp/livekit.RoomService/ListRooms',
      '/control?token=abc',
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
  });
});

describe('PWA manifests', () => {
  it('declares the original SVG logo for Audience and Control', () => {
    const audienceManifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    const controlManifest = JSON.parse(readFileSync('public/control-manifest.webmanifest', 'utf8'));

    expect(audienceManifest.start_url).toBe('/audience');
    expect(audienceManifest.scope).toBe('/audience');
    expect(controlManifest.start_url).toBe('/control');
    expect(controlManifest.scope).toBe('/control');

    for (const manifest of [audienceManifest, controlManifest]) {
      const iconSrcs = manifest.icons.map((icon: { src: string }) => icon.src);
      expect(iconSrcs).toContain('/logo.svg');
      expect(iconSrcs).not.toContain('/icons/sefer-icon-192.png');
      expect(iconSrcs).not.toContain('/icons/sefer-icon-512.png');
      expect(iconSrcs).not.toContain('/icons/sefer-maskable-512.png');
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
