const SW_VERSION = '1.3.0';
const CACHE_PREFIX = 'sefer-pwa';
const CACHE_NAME = `${CACHE_PREFIX}-v${SW_VERSION}`;

const CORE_ASSETS = [
  '/audience.html',
  '/control.html',
  '/metadata.json',
  '/audience-cache-assets.txt',
  '/logo.svg',
];

const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wav',
  '.flac',
]);

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.svg',
  '.avif',
]);

const getPathExtension = (pathname) => {
  const cleanPath = pathname.toLowerCase();
  const lastDot = cleanPath.lastIndexOf('.');
  if (lastDot < 0) return '';
  return cleanPath.slice(lastDot);
};

const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin;

function isMediaUrl(url) {
  const pathname = url.pathname.toLowerCase();
  return (
    pathname.startsWith('/videos/') ||
    pathname.startsWith('/audio/') ||
    MEDIA_EXTENSIONS.has(getPathExtension(pathname))
  );
}

function isImageUrl(url) {
  const pathname = url.pathname.toLowerCase();
  return (
    pathname.startsWith('/images/') ||
    IMAGE_EXTENSIONS.has(getPathExtension(pathname))
  );
}

function isNeverCacheUrl(url) {
  const pathname = url.pathname.toLowerCase();
  const search = url.search.toLowerCase();

  return (
    pathname === '/ws' ||
    pathname.startsWith('/ws/') ||
    pathname === '/rtc' ||
    pathname.startsWith('/rtc/') ||
    pathname === '/twirp' ||
    pathname.startsWith('/twirp/') ||
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.includes('state-events') ||
    pathname.includes('quiz-events') ||
    pathname.includes('livekit') ||
    pathname.includes('token') ||
    pathname === '/proteccion-datos' ||
    pathname.startsWith('/proteccion-datos/') ||
    pathname.startsWith('/legal/') ||
    search.includes('token=')
  );
}

const isLegalUrl = (url) => (
  url.pathname === '/proteccion-datos' ||
  url.pathname.startsWith('/proteccion-datos/') ||
  url.pathname.startsWith('/legal/')
);

function isAudienceShell(url) {
  const pathname = url.pathname;
  const isScopedShell =
    pathname === '/audience' ||
    pathname.startsWith('/audience/') ||
    pathname === '/control' ||
    pathname.startsWith('/control/');

  const isStaticAsset =
    pathname.includes('.') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/books/') ||
    pathname.startsWith('/videos/') ||
    pathname.startsWith('/audio/') ||
    pathname.startsWith('/images/');

  return isScopedShell && !isStaticAsset;
}

const isAudienceHtml = (url) => url.pathname === '/audience.html';
const isControlHtml = (url) => url.pathname === '/control.html';
const isAppAsset = (url) => url.pathname.startsWith('/assets/');
const isIconAsset = (url) => url.pathname === '/logo.svg' || url.pathname.startsWith('/icons/');
const isScriptureTsv = (url) => url.pathname.startsWith('/books/') && url.pathname.endsWith('.tsv');
const isMetadata = (url) => url.pathname === '/metadata.json';

const shouldCacheResponse = (response) => {
  if (!response || !response.ok) return false;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) return false;

  return true;
};

const loadConfiguredAssets = async () => {
  try {
    const response = await fetch('/audience-cache-assets.txt', { cache: 'no-store' });
    if (!response.ok) return [];

    const text = await response.text();

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.startsWith('/'))
      .filter((path) => !isNeverCacheUrl(new URL(path, self.location.origin)));
  } catch {
    return [];
  }
};

const cacheConfiguredAssets = async () => {
  const cache = await caches.open(CACHE_NAME);
  const configuredAssets = await loadConfiguredAssets();

  const cacheableAssets = [...CORE_ASSETS, ...configuredAssets]
    .filter((path) => !isNeverCacheUrl(new URL(path, self.location.origin)));

  await Promise.all(
    cacheableAssets.map((path) => cache.add(path).catch(() => undefined)),
  );
};

const putIfCacheable = async (cache, cacheKey, response) => {
  if (shouldCacheResponse(response)) {
    await cache.put(cacheKey, response.clone());
  }
};

const networkFirst = async (request, cacheKey = request) => {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: 'no-store' });
    await putIfCacheable(cache, cacheKey, response);
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
};

const cacheFirstWithUpdate = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const update = fetch(request).then(async (response) => {
    await putIfCacheable(cache, request, response);
    return response;
  });

  if (cached) {
    update.catch(() => undefined);
    return cached;
  }

  return update;
};

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const update = fetch(request, { cache: 'no-store' }).then(async (response) => {
    await putIfCacheable(cache, request, response);
    return response;
  });

  if (cached) {
    update.catch(() => undefined);
    return cached;
  }

  return update;
};

const shouldRuntimeCacheUrl = (url) => !isNeverCacheUrl(url) && !isMediaUrl(url);

self.addEventListener('install', (event) => {
  event.waitUntil(cacheConfiguredAssets().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || !isSameOrigin(request)) return;

  const url = new URL(request.url);

  if (isLegalUrl(url)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (isNeverCacheUrl(url)) return;

  if (isAudienceShell(url) || isAudienceHtml(url) || isControlHtml(url)) {
    const cacheKey = url.pathname.startsWith('/control') ? '/control.html' : '/audience.html';
    event.respondWith(networkFirst(request, cacheKey));
    return;
  }

  if (isMediaUrl(url)) {
    // Media is network-only unless it was explicitly listed for installation in
    // audience-cache-assets.txt. Avoid filling persistent browser storage with
    // arbitrary songs/videos requested during a session.
    return;
  }

  if (isImageUrl(url)) {
    event.respondWith(cacheFirstWithUpdate(request));
    return;
  }

  if (isAppAsset(url) || isIconAsset(url)) {
    event.respondWith(cacheFirstWithUpdate(request));
    return;
  }

  if (isMetadata(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isScriptureTsv(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

const swTestExports = {
  SW_VERSION,
  isNeverCacheUrl,
  isLegalUrl,
  isMediaUrl,
  isImageUrl,
  isAudienceShell,
  shouldRuntimeCacheUrl,
};

if (typeof self !== 'undefined') {
  self.__SEFER_PWA_TESTING__ = swTestExports;
}
