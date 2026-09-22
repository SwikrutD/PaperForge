# Editing model

How a change gets from a click to the file on disk, and how it is taken back.

This describes what exists today: page rotation and page deletion, undo and redo, and the save
pipeline they are written through. The text, image and annotation editors of later segments are
built on exactly this machinery, so the rules here are the ones they inherit.

## The shape of a change

An **operation** describes a change in terms of the document — "rotate pages 2 and 4 by 90°" — and
never in terms of bytes, offsets or files. A **transaction** is one or more operations under a
label, and is the unit of undo: one thing the reader did, one step back.

```
label: "Rotate page 3 right"
operations: [{ kind: "rotatePages", pages: [3], degrees: 90 }]
```

Operations are declared in `src/shared/schemas/edit.ts` and validated at the IPC boundary like
everything else, so the renderer cannot ask for something the schema does not describe.

`src/pdf/mutate/operations.ts` holds the arithmetic: page lists are sorted, de-duplicated and
clipped to the document; a later operation in the same transaction is read against the pages that
are left by the earlier ones; and a transaction that would empty a document is refused before
anything is written, because a PDF must keep at least one page.

## Where it runs

The renderer composes transactions. The main process applies them. The renderer never sees a path
and never writes a file.

```
renderer                      main process
────────                      ────────────
command ─ transaction ─IPC─▶  validate ─▶ engine.apply(bytes) ─▶ new revision file
                              ◀── DocumentEditState ────────────
viewer reloads pfdoc://document/<session>?r=<revision>
```

`PdfMutationEngine` (`src/pdf/mutate/types.ts`) is the contract; `pdfLibEngine.ts` is the only file
that imports pdf-lib, exactly as `pdfjsEngine.ts` is the only file that imports PDF.js. A second
write engine — qpdf for structural work, say — can be added behind the same interface.

pdf-lib rewrites the whole file rather than appending an incremental update. That is why every
revision is a complete document, and why PaperForge does not claim byte-level incremental saving
(`CLAUDE.md` section 9). The document's own metadata is left alone: PaperForge does not quietly
record itself as the producer of somebody else's file.

## Revisions are the undo history

A change writes a new file into the session's working directory:

```
%TEMP%/PaperForge/sessions/<session id>/
  journal.json            the recovery journal
  revisions/0000.pdf      the document as it was opened
  revisions/0001.pdf      after the first change
  revisions/0002.pdf      after the second
```

Undo moves a pointer back and the viewer reads the earlier file. Nothing is reversed, recomputed or
re-derived, so undo cannot drift from what was actually written — the failure mode of an
inverse-operation history, where an operation that is not perfectly invertible quietly corrupts the
document.

Revision 0 is written at the first change, not at open, so reading a document costs nothing. It is
the reason undo and revert still work after a save has replaced the original file.

A new change after an undo discards what was ahead, which is what makes redo mean "the change I
just took back" rather than a branch.

**Budget.** At most 30 revisions or 512 MB per document, whichever comes first. When the history
outgrows that, the oldest revisions are dropped and `historyTrimmed` says so; the window that
remains is contiguous, so undo never jumps over a change it cannot show. The revision being shown
is never dropped, and neither is the base snapshot.

**Cost.** Each change reads and rewrites the whole document. For the page operations that exist
today that is fast and predictable; when the editing segments bring changes that are made many
times in a row, this is the first place to look at batching.

## Saving

Nothing is written to the reader's file until they ask. `Save` writes the current revision;
`Save As` writes it somewhere else and carries on there; `Save a Copy` writes it somewhere else and
carries on here.

The write goes through `writeFileAtomic`, which writes a sibling temporary file, flushes it, and
only then renames it over the destination. Between the flush and the rename the file is checked:

1. **Reopened.** The bytes are parsed again from disk. A file PaperForge cannot read back is never
   published.
2. **Inspected by qpdf**, when qpdf is installed. Exit code 3 means warnings only, which plenty of
   perfectly good PDFs produce and which does not block a save. Anything worse does.

If either check fails, the temporary file is removed and the destination is untouched. That is the
whole point of the ordering: a failed save leaves the original exactly as it was.

**Before writing**, a save over the original also refuses two situations:

- The file is read-only — the reader is pointed at Save a Copy rather than being failed late.
- The file changed on disk since it was opened — the reader is told, and can overwrite anyway.

**After writing**, the session re-reads the file and ignores its own change events for two seconds,
so saving does not report itself as somebody else editing the file.

## What the renderer knows

```
revision · dirty · canUndo · canRedo · undoLabel · redoLabel · savedAt · historyTrimmed
```

The tab's unsaved marker, the enabled state of Save, Undo, Redo and Revert, and the URL the viewer
loads all come from this one record, so they cannot disagree. The revision is part of the document
URL, so a change makes the viewer load a document it has not seen rather than depend on a cache
being invalidated.

## Revert

Revert goes back to the revision that matches the file on disk. The revisions in between are kept,
so reverting is itself undoable — a reader who reverts by mistake has not lost their work.

## Limits today

- **Encrypted documents cannot be changed.** pdf-lib cannot decrypt, and PaperForge will not write
  a file it has not really understood. The password the viewer holds lives in the renderer and is
  never sent to the main process. Decryption belongs with the qpdf-based security tools.
- **Page rotation and deletion** are the only operations. They are the ones the Organize workspace
  needs, and they exercise the whole pipeline; text, images and annotations follow in their own
  segments.
- **A change is not written to disk until saved.** The working copies in the session directory are
  what a crash leaves behind for the recovery screen; recovering _unsaved changes_ from them is not
  implemented yet — the journal records that a document was dirty, and reopening it reopens the
  file as it is on disk.
