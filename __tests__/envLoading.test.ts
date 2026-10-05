import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadProjectEnvironment } from '../server/env-utils.mjs';

let directory: string | undefined;
const key = 'SEFER_ENV_PRECEDENCE_TEST';
const previous = process.env[key];
afterEach(() => {
  if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  if (directory) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('sefer-env-test-')) throw new Error('Unexpected cleanup target');
    fs.rmSync(directory, { recursive: true, force: true });
  }
  directory = undefined;
});
it.each([
  { inherited: 'external', local: 'local', expected: 'external' },
  { inherited: undefined, local: 'local', expected: 'local' },
  { inherited: undefined, local: undefined, expected: 'base' },
])('loads environment with explicit > local > base precedence: $expected', ({ inherited, local, expected }) => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-env-test-'));
  if (inherited === undefined) delete process.env[key]; else process.env[key] = inherited;
  fs.writeFileSync(path.join(directory, '.env'), key + '=base');
  if (local) fs.writeFileSync(path.join(directory, '.env.local'), key + '=' + local);
  loadProjectEnvironment(directory);
  expect(process.env[key]).toBe(expected);
});
