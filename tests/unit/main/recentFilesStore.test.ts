import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_FILES_FILE_NAME,
  RecentFilesStore,
} from '../../../src/main/services/recentFiles/recentFilesStore';
import { RECENT_FILES_LIMIT } from '../../../src/shared/schemas/recentFiles';
import type { Logger } from '../../../src/main/services/logging/logger';

const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

let directory = '';

async function newStore(): Promise<RecentFilesStore> {
  const store = new RecentFilesStore(directory, silentLogger);
  await store.load();
  return store;
}

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, minutes, 0));
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-recent-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('RecentFilesStore', () => {
  it('starts empty when no file exists', async () => {
    const store = await newStore();
    expect(store.list()).toEqual([]);
  });

  it('records an opened file and persists it across restarts', async () => {
    const store = await newStore();
    await store.add({ path: 'C:/Docs/Rapport final.pdf', openedAt: at(1), sizeBytes: 2048 });

    const reopened = await newStore();
    expect(reopened.list()).toEqual([
      {
        path: 'C:/Docs/Rapport final.pdf',
        displayName: 'Rapport final.pdf',
        lastOpenedAt: at(1).toISOString(),
        pinned: false,
        sizeBytes: 2048,
      },
    ]);
  });

  it('moves a re-opened file to the top instead of duplicating it', async () => {
    const store = await newStore();
    await store.add({ path: 'C:/Docs/a.pdf', openedAt: at(1) });
    await store.add({ path: 'C:/Docs/b.pdf', openedAt: at(2) });
    await store.add({ path: 'C:/docs/A.PDF', openedAt: at(3) });

    const paths = store.list().map((entry) => entry.path);
    expect(paths).toEqual(['C:/docs/A.PDF', 'C:/Docs/b.pdf']);
  });

  it('keeps pinned entries beyond the unpinned limit', async () => {
    const store = await newStore();
    await store.add({ path: 'C:/Docs/keep.pdf', openedAt: at(0) });
    await store.setPinned('C:/Docs/keep.pdf', true);

    for (let index = 1; index <= RECENT_FILES_LIMIT + 5; index += 1) {
      await store.add({ path: `C:/Docs/file-${index}.pdf`, openedAt: at(index) });
    }

    const entries = store.list();
    expect(entries.filter((entry) => entry.pinned).map((entry) => entry.path)).toEqual([
      'C:/Docs/keep.pdf',
    ]);
    expect(entries.filter((entry) => !entry.pinned)).toHaveLength(RECENT_FILES_LIMIT);
    expect(entries[0]?.pinned).toBe(true);
  });

  it('keeps the pinned flag when a pinned file is opened again', async () => {
    const store = await newStore();
    await store.add({ path: 'C:/Docs/a.pdf', openedAt: at(1) });
    await store.setPinned('C:/Docs/a.pdf', true);
    await store.add({ path: 'C:/Docs/a.pdf', openedAt: at(9) });

    expect(store.list()[0]).toMatchObject({ pinned: true, lastOpenedAt: at(9).toISOString() });
  });

  it('removes a single entry and clears everything on request', async () => {
    const store = await newStore();
    await store.add({ path: 'C:/Docs/a.pdf', openedAt: at(1) });
    await store.add({ path: 'C:/Docs/b.pdf', openedAt: at(2) });

    await store.remove('C:/docs/A.pdf');
    expect(store.list().map((entry) => entry.path)).toEqual(['C:/Docs/b.pdf']);

    await store.clear();
    expect(store.list()).toEqual([]);
    expect(await newStore().then((next) => next.list())).toEqual([]);
  });

  it('notifies listeners on every change', async () => {
    const store = await newStore();
    const listener = vi.fn();
    const dispose = store.onChange(listener);

    await store.add({ path: 'C:/Docs/a.pdf', openedAt: at(1) });
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    await store.add({ path: 'C:/Docs/b.pdf', openedAt: at(2) });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops invalid entries instead of failing to load', async () => {
    await fs.writeFile(
      path.join(directory, RECENT_FILES_FILE_NAME),
      JSON.stringify({
        version: 1,
        entries: [
          {
            path: 'C:/Docs/good.pdf',
            displayName: 'good.pdf',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            pinned: false,
          },
          { path: '', displayName: '', lastOpenedAt: 'x', pinned: 'nope' },
        ],
      }),
      'utf8',
    );

    const store = await newStore();
    expect(store.list().map((entry) => entry.path)).toEqual(['C:/Docs/good.pdf']);
  });
});
