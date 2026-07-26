import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readJsonWithRecovery,
  restoreJsonSafely,
  writeJsonSafely,
} from '../server/json-persistence.mjs';

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

  it('restores a validated value without overwriting its recovery backup', () => {
    const { filePath } = makeFixture();
    const backupPath = `${filePath}.bak`;
    fs.writeFileSync(filePath, '{broken', 'utf8');
    fs.writeFileSync(backupPath, '{"version":"known-good"}\n', 'utf8');

    const result = restoreJsonSafely(filePath, { version: 'known-good' });

    expect(['atomic-rename', 'bind-mount-in-place']).toContain(result.mode);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ version: 'known-good' });
    expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual({ version: 'known-good' });
  });

  it('recovers a corrupt primary only from a validated backup', () => {
    const { filePath } = makeFixture();
    const backupPath = `${filePath}.bak`;
    fs.writeFileSync(filePath, '{broken', 'utf8');
    fs.writeFileSync(backupPath, '{"version":"known-good"}\n', 'utf8');

    const result = readJsonWithRecovery({
      filePath,
      backupPath,
      fallback: {},
      validate: (value: unknown) => {
        if (
          typeof value !== 'object' ||
          value === null ||
          typeof (value as { version?: unknown }).version !== 'string'
        ) {
          throw new Error('version is required');
        }
        return value as { version: string };
      },
    });

    expect(result).toEqual({ value: { version: 'known-good' }, recovered: true });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ version: 'known-good' });
  });

  it('fails closed when neither primary nor backup is valid', () => {
    const { filePath } = makeFixture();
    const backupPath = `${filePath}.bak`;
    fs.writeFileSync(filePath, '{broken', 'utf8');
    fs.writeFileSync(backupPath, '[]\n', 'utf8');

    expect(() => readJsonWithRecovery({
      filePath,
      backupPath,
      fallback: {},
      validate: (value: unknown) => {
        if (!value || Array.isArray(value)) throw new Error('object required');
        return value;
      },
    })).toThrow(/Primary and backup are invalid/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{broken');
  });
});
