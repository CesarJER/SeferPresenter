const CACHE_NAME = 'sefer-audience-v1';
const CORE_ASSETS = [
  '/audience',
  '/metadata.json',
  '/audience-cache-assets.txt'
];

const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin;
const isAudienceShell = (url) => url.pathname === '/audience';
const isAppAsset = (url) => url.pathname.startsWith('/assets/');
const isScriptureTsv = (url) => url.pathname.startsWith('/books/') && url.pathname.endsWith('.tsv');
const isMetadata = (url) => url.pathname === '/metadata.json';

const loadConfiguredAssets = async () => {
  try {
    const response = await fetch('/audience-cache-assets.txt', { cache: 'no-store' });
    if (!response.ok) return [];
    const text = await response.text();
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.startsWith('/'));
  } catch {
    return [];
  }
};

const cacheConfiguredAssets = async () => {
  const cache = await caches.open(CACHE_NAME);
  const configuredAssets = await loadConfiguredAssets();
  await cache.addAll([...CORE_ASSETS, ...configuredAssets]);
};

self.addEventListener('install', (event) => {
  event.waitUntil(cacheConfiguredAssets().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isSameOrigin(request)) return;

  const url = new URL(request.url);
  const cacheable =
    isAudienceShell(url) ||
    isAppAsset(url) ||
    isScriptureTsv(url) ||
    isMetadata(url);

  if (!cacheable) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchAndCache = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      return cached || fetchAndCache;
    })
  );
});
