import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RevisionHistory } from '../../../src/main/services/documents/revisionHistory';

let directory = '';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function contentsOf(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-revisions-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('RevisionHistory', () => {
  it('starts with the document as it was opened', async () => {
    const history = new RevisionHistory(directory);
    expect(history.started).toBe(false);

    const base = await history.begin(bytes('original'));

    expect(history.started).toBe(true);
    expect(history.currentRevision).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(await contentsOf(base.filePath)).toBe('original');
  });

  it('steps back and forward through changes', async () => {
    const history = new RevisionHistory(directory);
    await history.begin(bytes('v0'));
    await history.push('Rotate page 1', bytes('v1'));
    await history.push('Delete page 2', bytes('v2'));

    expect(history.currentRevision).toBe(2);
    expect(history.undoLabel).toBe('Delete page 2');
    expect(history.redoLabel).toBeNull();

    expect(history.undo()?.revision).toBe(1);
    expect(await contentsOf(history.current!.filePath)).toBe('v1');
    expect(history.undoLabel).toBe('Rotate page 1');
    expect(history.redoLabel).toBe('Delete page 2');

    expect(history.undo()?.revision).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeUndefined();

    expect(history.redo()?.revision).toBe(1);
    expect(history.redo()?.revision).toBe(2);
    expect(history.redo()).toBeUndefined();
  });

  // Redo means "the change I just took back", so a new change after an undo
  // replaces what was ahead rather than branching.
  it('discards undone changes when a new one arrives', async () => {
    const history = new RevisionHistory(directory);
    await history.begin(bytes('v0'));
    await history.push('First', bytes('v1'));
    const discarded = (await history.push('Second', bytes('v2'))).filePath;

    history.undo();
    history.undo();
    await history.push('Instead', bytes('v3'));

    expect(history.canRedo).toBe(false);
    expect(await contentsOf(history.current!.filePath)).toBe('v3');
    await expect(fs.stat(discarded)).rejects.toThrow();
  });

  // The viewer, the text editor and the comment list all treat a revision
  // number as naming one set of bytes. Handing out 1 again after undoing the
  // first 1 made them show — and edit — the undone document.
  it('never reuses a revision number, not even after an undo', async () => {
    const history = new RevisionHistory(directory);
    await history.begin(bytes('v0'));
    await history.push('First', bytes('v1'));
    await history.push('Second', bytes('v2'));

    history.undo();
    history.undo();
    const instead = await history.push('Instead', bytes('v3'));

    expect(instead.revision).toBe(3);
    expect(history.currentRevision).toBe(3);
    expect(history.undo()?.revision).toBe(0);
    expect(history.redo()?.revision).toBe(3);
  });

  it('finds a revision still on disk, and nothing for one discarded', async () => {
    const history = new RevisionHistory(directory);
    await history.begin(bytes('v0'));
    await history.push('First', bytes('v1'));
    history.undo();
    await history.push('Instead', bytes('v2'));

    expect(await contentsOf(history.find(0)!.filePath)).toBe('v0');
    expect(await contentsOf(history.find(2)!.filePath)).toBe('v2');
    expect(history.find(1)).toBeUndefined();
  });

  it('goes to a revision for revert, keeping what came after', async () => {
    const history = new RevisionHistory(directory);
    await history.begin(bytes('v0'));
    await history.push('First', bytes('v1'));
    await history.push('Second', bytes('v2'));

    expect(history.goTo(0)?.revision).toBe(0);
    expect(history.canRedo).toBe(true);
    expect(history.redo()?.revision).toBe(1);
    expect(history.goTo(99)).toBeUndefined();
  });

  it('trims the oldest revisions when the history outgrows its budget', async () => {
    const history = new RevisionHistory(directory, { maxRevisions: 3, maxBytes: 1024 * 1024 });
    await history.begin(bytes('v0'));
    for (let index = 1; index <= 5; index += 1) {
      await history.push(`Change ${index}`, bytes(`v${index}`));
    }

    expect(history.trimmed).toBe(true);
    expect(history.currentRevision).toBe(5);

    // Undo still works, down to the floor the trim left behind.
    let steps = 0;
    while (history.canUndo) {
      history.undo();
      steps += 1;
    }
    expect(steps).toBe(2);
    expect(history.currentRevision).toBe(3);

    // The base snapshot stays on disk even once undo cannot reach it, because
    // revert needs the document as it was opened.
    expect(await contentsOf(history.base!.filePath)).toBe('v0');
  });

  it('trims on size as well as on count', async () => {
    const history = new RevisionHistory(directory, { maxRevisions: 100, maxBytes: 40 });
    await history.begin(bytes('0'.repeat(20)));
    await history.push('One', bytes('1'.repeat(20)));
    await history.push('Two', bytes('2'.repeat(20)));

    expect(history.trimmed).toBe(true);
    expect(history.canUndo).toBe(true);
    expect(history.undo()?.revision).toBe(1);
    expect(history.canUndo).toBe(false);
  });

  it('never trims the revision being shown', async () => {
    const history = new RevisionHistory(directory, { maxRevisions: 1, maxBytes: 1 });
    await history.begin(bytes('v0'));
    await history.push('One', bytes('v1'));

    expect(history.currentRevision).toBe(1);
    expect(await contentsOf(history.current!.filePath)).toBe('v1');
    expect(history.canUndo).toBe(false);
  });

  it('removes everything it owns when the document closes', async () => {
    const history = new RevisionHistory(directory);
    await history.begin(bytes('v0'));
    await history.push('One', bytes('v1'));

    await history.dispose();

    expect(history.started).toBe(false);
    await expect(fs.stat(directory)).rejects.toThrow();
  });
});
