import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeJsonSafely } from '../server/json-persistence.mjs';

const temporaryDirectories: string[] = [];

const makeFixture = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-json-persistence-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'data.json');
  fs.writeFileSync(filePath, '{"version":"old"}\n', 'utf8');
  return { directory, filePath };
};

describe('safe JSON persistence', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('commits a prepared file and retains a recoverable backup', () => {
    const { directory, filePath } = makeFixture();
    const result = writeJsonSafely(filePath, { version: 'new' });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ version: 'new' });
    expect(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8'))).toEqual({ version: 'old' });
    expect(['atomic-rename', 'bind-mount-in-place']).toContain(result.mode);
    expect(fs.readdirSync(directory).sort()).toEqual(['data.json', 'data.json.bak']);
  });

  it('makes the bind-mount limitation explicit and backs up before in-place fallback', () => {
    const { filePath } = makeFixture();
    const result = writeJsonSafely(filePath, { version: 'new' }, { forceInPlaceFallback: true });

    expect(result.mode).toBe('bind-mount-in-place');
    expect(result.limitation).toMatch(/not atomic/i);
    expect(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8'))).toEqual({ version: 'old' });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ version: 'new' });
  });

  it('does not touch the original if serialization fails before preparation', () => {
    const { filePath } = makeFixture();

    expect(() => writeJsonSafely(filePath, { unsupported: 1n })).toThrow();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"version":"old"}\n');
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });
});
