import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSeferDataPaths,
  initializeSeferDataDir,
  resolveSeferDataDir,
} from '../server/data-directory.mjs';

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-data-test-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Sefer data directory', () => {
  it('resolves the default and configured roots relative to the application root', () => {
    const rootDir = makeTemporaryDirectory();

    expect(resolveSeferDataDir({ rootDir })).toBe(path.join(rootDir, 'data.local'));
    expect(resolveSeferDataDir({ rootDir, configuredPath: '../private-data' }))
      .toBe(path.resolve(rootDir, '../private-data'));
  });

  it('copies example files only when the target is missing', () => {
    const rootDir = makeTemporaryDirectory();
    const exampleDir = path.join(rootDir, 'example');
    const dataDir = path.join(rootDir, 'data');
    fs.mkdirSync(path.join(exampleDir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(exampleDir, 'presentations.json'), '[{"id":"example"}]\n');
    fs.writeFileSync(path.join(exampleDir, 'config', 'audience-cache-assets.txt'), '/favicon.svg\n');

    const firstRun = initializeSeferDataDir({ dataDir, exampleDir });
    expect(firstRun.created).toEqual(expect.arrayContaining([
      'config/audience-cache-assets.txt',
      'presentations.json',
    ]));
    expect(fs.statSync(path.join(dataDir, 'public')).isDirectory()).toBe(true);

    fs.writeFileSync(path.join(dataDir, 'presentations.json'), '[{"id":"operator"}]\n');
    const secondRun = initializeSeferDataDir({ dataDir, exampleDir });

    expect(secondRun.preserved).toContain('presentations.json');
    expect(fs.readFileSync(path.join(dataDir, 'presentations.json'), 'utf8'))
      .toBe('[{"id":"operator"}]\n');
  });

  it('returns stable paths for persisted and future branding data', () => {
    const dataDir = path.resolve('operator-data');
    const paths = getSeferDataPaths(dataDir);

    expect(paths.presentations).toBe(path.join(dataDir, 'presentations.json'));
    expect(paths.audioSync).toBe(path.join(dataDir, 'audio_sync.json'));
    expect(paths.audienceCacheAssets).toBe(path.join(dataDir, 'config', 'audience-cache-assets.txt'));
    expect(paths.public).toBe(path.join(dataDir, 'public'));
    expect(paths.branding.favicon).toBe(path.join(dataDir, 'branding', 'favicon.svg'));
  });

  it('rejects an example directory that does not exist', () => {
    const rootDir = makeTemporaryDirectory();

    expect(() => initializeSeferDataDir({
      dataDir: path.join(rootDir, 'data'),
      exampleDir: path.join(rootDir, 'missing-example'),
    })).toThrow('Example data directory not found');
  });
});
