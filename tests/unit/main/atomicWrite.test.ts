import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../../src/main/services/filesystem/atomicWrite';
import { AppError } from '../../../src/shared/errors/appError';

let directory = '';

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-test-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes a new file and leaves no temporary files behind', async () => {
    const target = path.join(directory, 'settings.json');
    await writeFileAtomic(target, '{"ok":true}');
    expect(await fs.readFile(target, 'utf8')).toBe('{"ok":true}');
    expect(await fs.readdir(directory)).toEqual(['settings.json']);
  });

  it('replaces an existing file in place', async () => {
    const target = path.join(directory, 'notes déjà.txt');
    await writeFileAtomic(target, 'first');
    await writeFileAtomic(target, 'second');
    expect(await fs.readFile(target, 'utf8')).toBe('second');
    expect(await fs.readdir(directory)).toHaveLength(1);
  });

  it('creates missing parent directories', async () => {
    const target = path.join(directory, 'nested folder', 'a.txt');
    await writeFileAtomic(target, 'x');
    expect(await fs.readFile(target, 'utf8')).toBe('x');
  });

  it('reports a typed error when the destination is a directory', async () => {
    const target = path.join(directory, 'occupied');
    await fs.mkdir(target);
    await expect(writeFileAtomic(target, 'x')).rejects.toBeInstanceOf(AppError);
  });
});
