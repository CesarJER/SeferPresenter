import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBrandingAsset, makeBrandingEtag } from '../server/branding-assets.mjs';

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-branding-test-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('branding assets', () => {
  it('prefers a valid instance override', () => {
    const directory = makeTemporaryDirectory();
    const overridePath = path.join(directory, 'override.svg');
    const fallbackPath = path.join(directory, 'fallback.svg');
    fs.writeFileSync(overridePath, '<svg>instance</svg>');
    fs.writeFileSync(fallbackPath, '<svg>product</svg>');

    const asset = loadBrandingAsset({ overridePath, fallbackPath });

    expect(asset.body.toString('utf8')).toBe('<svg>instance</svg>');
    expect(asset.etag).toBe(makeBrandingEtag(asset.body));
  });

  it('uses the product fallback when the override is absent', () => {
    const directory = makeTemporaryDirectory();
    const overridePath = path.join(directory, 'override.svg');
    const fallbackPath = path.join(directory, 'fallback.svg');
    fs.writeFileSync(fallbackPath, '<svg>product</svg>');

    const fallback = loadBrandingAsset({ overridePath, fallbackPath });
    expect(fallback.body.toString('utf8')).toBe('<svg>product</svg>');
  });

  it('fails closed when neither source is a usable regular file', () => {
    const directory = makeTemporaryDirectory();

    expect(() => loadBrandingAsset({
      overridePath: path.join(directory, 'missing-override.svg'),
      fallbackPath: path.join(directory, 'missing-fallback.svg'),
    })).toThrow('Branding fallback is missing or invalid');
  });

  it('changes the ETag when the content changes', () => {
    expect(makeBrandingEtag(Buffer.from('first'))).not.toBe(makeBrandingEtag(Buffer.from('second')));
  });
});
