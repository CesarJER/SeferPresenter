import { describe, expect, it } from 'vitest';
import { createAudienceServiceWorkerSource } from '../server/pwa-build.mjs';

describe('Audience service worker build manifest', () => {
  it('injects deterministic hashed bundle assets and a build-specific cache version', () => {
    const template = [
      "const SW_VERSION = 'dev';",
      'const BUILD_ASSETS = [];',
    ].join('\n');
    const source = createAudienceServiceWorkerSource(template, [
      'assets/a-123.js',
      'audience.html',
      'assets/app-456.css',
      'assets/a-123.js',
    ]);

    expect(source).toContain("const SW_VERSION = '");
    expect(source).not.toContain("const SW_VERSION = 'dev'");
    expect(source).toContain('"/assets/a-123.js"');
    expect(source).toContain('"/assets/app-456.css"');
    expect(source.match(/a-123\.js/g)).toHaveLength(1);
    expect(source).not.toContain('audience.html');
  });
});
