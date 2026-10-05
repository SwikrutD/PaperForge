import fs from 'node:fs/promises';
import path from 'node:path';

/** At most this many revisions are kept on disk for one document. */
export const MAX_REVISIONS = 30;
/** And at most this many bytes of them, so a long session cannot fill a disk. */
export const MAX_HISTORY_BYTES = 512 * 1024 * 1024;

export interface Revision {
  /** 0 is the document as it was opened; each applied change adds one. */
  revision: number;
  /** Absolute path of the file holding these bytes. */
  filePath: string;
  /** What produced this revision, shown on Undo and Redo. */
  label: string;
  sizeBytes: number;
}

export interface HistoryLimits {
  maxRevisions: number;
  maxBytes: number;
}

const DEFAULT_LIMITS: HistoryLimits = {
  maxRevisions: MAX_REVISIONS,
  maxBytes: MAX_HISTORY_BYTES,
};

/**
 * The undo history of one document, as files.
 *
 * A revision is a whole document rather than a description of a change, so
 * undo cannot drift from what was actually written: stepping back means
 * reading an earlier file, not reversing an operation. Revision 0 is a
 * snapshot of the file as it was opened, taken when the first change is made,
 * so undo and revert keep working even after the original has been saved over.
 *
 * The history is trimmed from the oldest end when it outgrows its budget. The
 * window that remains is contiguous, so undo never jumps over a change it
 * cannot show; `trimmed` says that the floor has moved, which the UI explains.
 */
export class RevisionHistory {
  private readonly entries: Revision[] = [];
  /** Index into `entries` of the revision being shown. */
  private currentIndex = -1;
  /** Index of the oldest revision still on disk and reachable by undo. */
  private floorIndex = 0;
  private trimmedHistory = false;
  /**
   * The highest revision number ever handed out. Numbers are never reused, not
   * even for a change made after an undo: everything downstream — the viewer's
   * URL, the models read from a page — treats a revision number as naming one
   * set of bytes for good.
   */
  private lastRevision = 0;

  constructor(
    readonly directory: string,
    private readonly limits: HistoryLimits = DEFAULT_LIMITS,
  ) {}

  /** True once the document has been changed at all. */
  get started(): boolean {
    return this.entries.length > 0;
  }

  get current(): Revision | undefined {
    return this.entries[this.currentIndex];
  }

  get currentRevision(): number {
    return this.current?.revision ?? 0;
  }

  get canUndo(): boolean {
    return this.currentIndex > this.floorIndex;
  }

  get canRedo(): boolean {
    return this.currentIndex >= 0 && this.currentIndex < this.entries.length - 1;
  }

  /** What Undo would take back, for the command's label. */
  get undoLabel(): string | null {
    return this.canUndo ? (this.entries[this.currentIndex]?.label ?? null) : null;
  }

  /** What Redo would put back. */
  get redoLabel(): string | null {
    return this.canRedo ? (this.entries[this.currentIndex + 1]?.label ?? null) : null;
  }

  get trimmed(): boolean {
    return this.trimmedHistory;
  }

  /** The base snapshot, which revert falls back to. */
  get base(): Revision | undefined {
    return this.entries[0];
  }

  /**
   * Records the document as it was opened. Called once, immediately before the
   * first change, with the bytes that were read to make that change.
   */
  async begin(bytes: Uint8Array): Promise<Revision> {
    await fs.mkdir(this.directory, { recursive: true });
    const entry = await this.write(0, 'Opened', bytes);
    this.entries.push(entry);
    this.currentIndex = 0;
    return entry;
  }

  /**
   * Adds a revision after the current one. Anything that had been undone is
   * discarded first, which is what makes redo mean "the change I just took
   * back" rather than a branch.
   */
  async push(label: string, bytes: Uint8Array): Promise<Revision> {
    await this.dropAfterCurrent();
    const revision = this.lastRevision + 1;
    this.lastRevision = revision;
    const entry = await this.write(revision, label, bytes);
    this.entries.push(entry);
    this.currentIndex = this.entries.length - 1;
    await this.enforceLimits();
    return entry;
  }

  /** A revision that is still on disk, current or not. */
  find(revision: number): Revision | undefined {
    const index = this.entries.findIndex((entry) => entry.revision === revision);
    return index < 0 || (index < this.floorIndex && revision !== 0)
      ? undefined
      : this.entries[index];
  }

  undo(): Revision | undefined {
    if (!this.canUndo) return undefined;
    this.currentIndex -= 1;
    return this.current;
  }

  redo(): Revision | undefined {
    if (!this.canRedo) return undefined;
    this.currentIndex += 1;
    return this.current;
  }

  /**
   * Moves back to a revision that is still on disk, for Revert to Saved. The
   * revisions in between stay, so reverting can itself be undone.
   */
  goTo(revision: number): Revision | undefined {
    const index = this.entries.findIndex((entry) => entry.revision === revision);
    if (index < 0 || index < this.floorIndex) return undefined;
    this.currentIndex = index;
    return this.current;
  }

  /** Removes every file this history owns. Called when the document closes. */
  async dispose(): Promise<void> {
    this.entries.length = 0;
    this.currentIndex = -1;
    await fs.rm(this.directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private async write(revision: number, label: string, bytes: Uint8Array): Promise<Revision> {
    const filePath = path.join(this.directory, `${String(revision).padStart(4, '0')}.pdf`);
    await fs.writeFile(filePath, bytes);
    return { revision, filePath, label, sizeBytes: bytes.byteLength };
  }

  /** Discards undone revisions; their files are no longer reachable. */
  private async dropAfterCurrent(): Promise<void> {
    const removed = this.entries.splice(this.currentIndex + 1);
    for (const entry of removed) {
      await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Keeps the history inside its budget by dropping the oldest revisions. The
   * current one is never dropped — it is the document — and neither is the
   * base snapshot, which revert needs.
   */
  private async enforceLimits(): Promise<void> {
    const overLimit = (): boolean => {
      const window = this.entries.slice(this.floorIndex);
      const bytes = window.reduce((total, entry) => total + entry.sizeBytes, 0);
      return window.length > this.limits.maxRevisions || bytes > this.limits.maxBytes;
    };

    while (overLimit() && this.floorIndex < this.currentIndex) {
      const dropped = this.entries[this.floorIndex];
      this.floorIndex += 1;
      this.trimmedHistory = true;
      // The base snapshot stays on disk even once undo can no longer reach it.
      if (dropped !== undefined && dropped.revision !== 0) {
        await fs.rm(dropped.filePath, { force: true }).catch(() => undefined);
      }
    }
  }
}
