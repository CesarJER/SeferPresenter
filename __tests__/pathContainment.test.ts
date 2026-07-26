import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInsideRoot, resolvePathInsideRoot } from '../server/path-containment.mjs';

describe('static path containment', () => {
  const parent = path.resolve('fixture-parent');
  const root = path.join(parent, 'dist');

  it('accepts the root itself and nested files', () => {
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, 'assets', 'app.js'))).toBe(true);
    expect(resolvePathInsideRoot(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
  });

  it('rejects traversal and sibling-prefix escapes', () => {
    const siblingPrefix = path.join(parent, 'dist-private', 'secret.json');

    expect(isPathInsideRoot(root, siblingPrefix)).toBe(false);
    expect(resolvePathInsideRoot(root, '../dist-private/secret.json')).toBeNull();
    expect(resolvePathInsideRoot(root, '..\\dist-private\\secret.json')).toBeNull();
  });

  it('rejects non-string request paths', () => {
    expect(resolvePathInsideRoot(root, null as never)).toBeNull();
  });
});
