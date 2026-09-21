import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInside, resolveWithinRoot } from '../../../src/main/services/filesystem/pathSafety';

const root = path.resolve('C:/PaperForge/renderer');

describe('path containment', () => {
  it('resolves ordinary asset paths', () => {
    expect(resolveWithinRoot(root, '/index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveWithinRoot(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
  });

  it('handles spaces and non-ASCII names', () => {
    expect(resolveWithinRoot(root, '/assets/Rapport final é 日本.css')).toBe(
      path.join(root, 'assets', 'Rapport final é 日本.css'),
    );
  });

  it('rejects traversal in every shape', () => {
    expect(resolveWithinRoot(root, '/../secrets.txt')).toBeNull();
    expect(resolveWithinRoot(root, '/assets/../../secrets.txt')).toBeNull();
    expect(resolveWithinRoot(root, String.raw`/..\\secrets.txt`)).toBeNull();
    expect(resolveWithinRoot(root, 'C:/Windows/System32/drivers/etc/hosts')).toBeNull();
    expect(resolveWithinRoot(root, '/index.html\0.png')).toBeNull();
    expect(resolveWithinRoot(root, '/')).toBeNull();
  });

  it('treats the root itself as inside', () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(root, path.join(root, 'a', 'b'))).toBe(true);
    expect(isPathInside(root, path.resolve('C:/PaperForge/renderer-other'))).toBe(false);
    expect(isPathInside(root, path.resolve('C:/PaperForge'))).toBe(false);
  });
});
