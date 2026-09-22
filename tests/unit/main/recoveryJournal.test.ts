import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOURNAL_FILE_NAME,
  SessionWorkspaces,
  type Journal,
} from '../../../src/main/services/recovery/recoveryJournal';
import type { Logger } from '../../../src/main/services/logging/logger';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let root = '';
let workspaces: SessionWorkspaces;

function journalFor(sessionId: string, overrides: Partial<Journal> = {}): Journal {
  return {
    version: 1,
    sessionId,
    documentId: `doc-${sessionId}`,
    path: path.join(root, 'documents', `${sessionId}.pdf`),
    displayName: `${sessionId}.pdf`,
    openedAt: '2026-09-22T08:00:00.000Z',
    lastTouchedAt: '2026-09-22T08:05:00.000Z',
    dirty: false,
    pid: 1234,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-recovery-'));
  await fs.mkdir(path.join(root, 'documents'), { recursive: true });
  workspaces = new SessionWorkspaces(path.join(root, 'temp'), logger);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('SessionWorkspaces', () => {
  it('creates a working directory with a readable journal', async () => {
    const directory = await workspaces.create(journalFor('alpha'));

    expect(await fs.readdir(directory)).toEqual([JOURNAL_FILE_NAME]);
    expect(await workspaces.read('alpha')).toMatchObject({ sessionId: 'alpha', dirty: false });
  });

  it('updates a journal in place', async () => {
    await workspaces.create(journalFor('alpha'));
    await workspaces.write(
      journalFor('alpha', { dirty: true, lastTouchedAt: '2026-09-22T09:00:00.000Z' }),
    );

    expect(await workspaces.read('alpha')).toMatchObject({
      dirty: true,
      lastTouchedAt: '2026-09-22T09:00:00.000Z',
    });
  });

  it('lists leftover sessions newest first, with the file existence checked', async () => {
    const existing = path.join(root, 'documents', 'alpha.pdf');
    await fs.writeFile(existing, '%PDF-1.7\n');

    await workspaces.create(journalFor('alpha', { lastTouchedAt: '2026-09-22T08:00:00.000Z' }));
    await workspaces.create(journalFor('beta', { lastTouchedAt: '2026-09-22T10:00:00.000Z' }));

    const entries = await workspaces.listRecoverable();

    expect(entries.map((entry) => entry.sessionId)).toEqual(['beta', 'alpha']);
    expect(entries.find((entry) => entry.sessionId === 'alpha')?.fileStillExists).toBe(true);
    expect(entries.find((entry) => entry.sessionId === 'beta')?.fileStillExists).toBe(false);
  });

  it('ignores sessions that are currently open', async () => {
    await workspaces.create(journalFor('alpha'));
    await workspaces.create(journalFor('beta'));

    const entries = await workspaces.listRecoverable(new Set(['alpha']));
    expect(entries.map((entry) => entry.sessionId)).toEqual(['beta']);
  });

  it('cleans up a session directory whose journal is unusable', async () => {
    const directory = workspaces.directoryFor('broken');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, JOURNAL_FILE_NAME), '{ not json');

    expect(await workspaces.listRecoverable()).toEqual([]);
    expect(await workspaces.listSessionIds()).toEqual([]);
  });

  it('removes a session on request', async () => {
    await workspaces.create(journalFor('alpha'));
    await workspaces.remove('alpha');

    expect(await workspaces.listSessionIds()).toEqual([]);
    expect(await workspaces.read('alpha')).toBeUndefined();
  });

  it('reports no leftovers when nothing has ever been opened', async () => {
    expect(await workspaces.listSessionIds()).toEqual([]);
    expect(await workspaces.listRecoverable()).toEqual([]);
  });
});
