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

## Editing text

A page's drawing is a content stream: operands, then the operator that consumes them. PaperForge
reads it with its own parser (`src/pdf/content`), which records where every operand begins and ends,
and a state machine that follows the transform, the text state and the fill colour. Each show
operation — `Tj`, `TJ`, `'`, `"` — becomes a **run**: what it says, where its baseline starts, how
wide it is, which font drew it, and the exact bytes that hold its text.

Fonts come from the page's own resources: encodings and `/Differences`, `ToUnicode` CMaps (read
with the same parser, since a CMap is written the same way), simple and composite widths, and the
metrics of the standard fourteen for fonts that state none.

### Tier A — the native rewrite

When the font that drew a run can write the new text, PaperForge replaces the run's own operand and
nothing else:

```
BT /F1 18 Tf 1 0 0 1 60 700 Tm (The first line) Tj ET
                               ^^^^^^^^^^^^^^^^ only this changes
```

The bytes before and after are copied through untouched, so the rest of the page — its drawings,
its other text, its marked content — is the same file it was. A `TJ` array is written back as a
single string, because the offsets in it belonged to the old text.

The run keeps its starting point whatever its new length. What follows it on the line moves with it
if the stream positioned it relatively, and stays where it is if the stream positioned it
absolutely — which is exactly what the original PDF would have done had it been written that way.

### Tier B — the replacement

When the font a run is drawn in cannot write the new text, PaperForge does not force it. The run is
**neutralised** and the text is **drawn again** in a font PaperForge controls:

```
(the old words) Tj      becomes     [ -4821.5 ] TJ
```

`[ n ] TJ` draws nothing and moves the pen exactly as far as the old glyphs did, so whatever
followed on the line stays where it was. The new text is then appended to the page's content as its
own `q … BT … ET … Q` block, at the same transform, size, colour and spacing — drawn last, so it
sits over the page rather than under it.

The reader is asked first. Replacing is a different thing from rewriting — the letterforms change —
so PaperForge says which character stopped it, offers the replacement, and does nothing until the
reader agrees. A run whose font never says what its codes mean is marked in the editor and replaced
outright when typed into, because there is nothing to rewrite.

Text PaperForge drew itself is named `PF…` in the page's resources, which is how the editor knows
to tell the reader "PaperForge drew this text, in a standard font, in place of what was here".

### Adding text

**Add text** puts a caret where the reader clicks and appends the same kind of block. Nothing is
removed, and the page keeps everything it had.

### The fonts PaperForge draws with

The fourteen fonts every PDF reader already has — Helvetica, Times, Courier and their bold and
italic variants. Nothing is embedded, so a file PaperForge writes text into carries no font program
that was not already there, and no font is redistributed.

That also sets the limit: those fonts are Latin-1. Text outside it — Cyrillic, Greek, CJK — cannot
be drawn with them, so PaperForge refuses it and says why rather than writing question marks.
Embedding a system font for other writing systems is the work `CLAUDE.md` section 13.4 describes,
and it is not built yet.

### What the editor refuses

- a font that does not say what its codes mean (no `ToUnicode`, no usable encoding) cannot be
  **rewritten**, only replaced;
- text outside Latin-1 cannot be written at all yet, in either tier;
- text drawn inside a form XObject is not listed, because the parser reads the page's own content
  stream; the editor says plainly when it finds no text it can edit on a page.

### What a change costs

A text edit is an `editText` operation like any other: it goes through the same transaction, makes
a new revision, and is undone by moving the revision pointer. The page's content is written back as
a single uncompressed stream, which the optimizer compresses when the reader asks it to.

Run ids (`op12`) name the operation the run came from and hold only for the revision they were read
from. Every change rewrites the page, so the editor reads the page again afterwards rather than
patching what it had.

## Editing images

A page draws an image by mapping the unit square onto the page with the current transform and then
saying `Do`. Everything the editor needs follows from that one matrix: where the image sits, how
big it is, how far it is turned, and whether it has been mirrored.

### Changing one in place

Every image edit replaces the `Do` operation where it stands with

```
q [/PFAlphaNN gs] <M> cm [x y w h re W n] /Name Do Q
```

where `M = new × inverse(current)`. The inverse cancels whatever transform the page had already
built up, so what is left inside the `q`/`Q` is exactly the placement the reader asked for,
whatever route the page took to get there.

Editing in place is what keeps the drawing order. Appending the image to the end of the stream
would lift it in front of anything that used to cover it — a caption, a box, a redaction — and the
page would no longer look like itself.

A page that draws an image with a transform that cannot be inverted (everything flattened onto a
line) is refused with a message that says so, rather than moved to a place that means nothing.

### What each edit is

| Edit                       | What is written                                                      |
| -------------------------- | -------------------------------------------------------------------- |
| Move, resize, turn, mirror | A new matrix, built by `placementMatrix` from the box and the turn   |
| Crop                       | `x y w h re W n` inside the block: a clip, in the image's own square |
| Opacity                    | `/PFAlphaNN gs`, a transparency state in the page's resources        |
| Replace                    | The new image embedded as `PFImgN`, drawn with the same matrix       |
| Delete                     | The operation removed; nothing else on the page moves                |
| Add                        | `q … cm /PFImgN Do Q` appended, so it goes on top                    |

Cropping clips rather than re-encoding: the picture keeps every pixel it arrived with, and the crop
can be taken off again. Reading a page back recovers the crop from the clip and the opacity from
the transparency state, so neither is cumulative and the panel says what the page does rather than
what was last asked for.

Mirroring down is mirroring across turned half a circle — the same matrix — so that is how a
mirrored image is reported, and what is read back is what was written.

### Writing an image out

A stream that is already a JPEG is handed over untouched. Anything else is decoded to its samples
and written as a PNG by a small encoder in `imageResources.ts` — stored deflate blocks, no
dependency, lossless. An image in an indexed or ICC colour space is written with its samples as
they are; a CMYK image is refused rather than guessed at.

## Links

A link is a `/Link` annotation: a rectangle with somewhere to go. PaperForge writes two
destinations and no others — a page of this document (`/Dest [page /Fit]`) and an `http`, `https`
or `mailto` address (`/A << /S /URI >>`). Anything else the file already carries is described to
the reader as it is: a named destination, a launch action, embedded JavaScript. None of it is
followed, and none of it is rewritten unless the reader points the link somewhere new, which
replaces the whole annotation rather than leaving the old action beside the new destination.

Links PaperForge makes are named `PFLinkN` in `/NM`, so they can be told from the document's own.

## Page furniture

Watermarks, backgrounds, headers and footers are drawn by PaperForge rather than by the document,
so each is wrapped in marked content named after what it is:

```
/PFWatermark BMC q … Q EMC
```

`BMC` rather than `BDC`, because a tag with no property list is what this is. The mark is what lets
PaperForge find its own work again: applying a watermark to a page that already carries one
replaces it instead of stacking a second on top, and Remove takes it off and leaves the page
underneath byte for byte as it was. A page that carries no PaperForge furniture is never touched.

A background is put before the page's own drawing, which is wrapped in `q`/`Q` as it moves along so
nothing the background sets can leak into it. A watermark goes before or after as the reader asks.

Headers and footers are written with tokens — `{{page}}`, `{{pages}}`, `{{date}}`, `{{title}}`,
`{{bates}}` — so one line serves every page. The window resolves the date and the title, because
locales belong to the window; the engine resolves the numbering, because only it knows which page
is which. `{{page}}` starts from the number the reader gives the first page in the range, and a
Bates number is a prefix, a zero-padded count and a suffix.

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
- **Shapes are annotations, not page content.** A rectangle, ellipse, line, arrow, polygon or ink
  stroke is written as a real PDF annotation with an appearance stream and the print flag set, and
  it can be selected, moved and deleted afterwards. PaperForge does not also draw shapes into the
  content stream, because content it cannot then select would be a shape the reader could only
  remove by undoing. Turning an annotation into page content is what flattening is for, in
  Segment 11.
- **An image in a form XObject is not listed**, for the same reason text inside one is not: the
  editor reads the page's own content stream.
- **A clip the page sets around its whole content is not called a crop.** Only a clip written
  beside the image counts as one, which is what PaperForge itself writes.
- **Text editing is Tier A and Tier B.** A run is rewritten in its own font where that works, and
  otherwise taken out and drawn again in a standard font, with the reader asked first.
- **PaperForge draws with the standard fourteen fonts, which are Latin-1.** Text in another writing
  system is refused, with the character that stopped it named. Embedding a system font is not built
  yet.
- **Text inside a form XObject is not listed.** The editor reads the page's own content stream, and
  says when it finds nothing it can edit.
- **Reflow is not attempted.** A run keeps its own position; changing its length moves what follows
  it only as far as the stream's own positioning does.
- **A rewritten page's content is written as one uncompressed stream.** It is what PaperForge can
  read back. Optimize PDF compresses it (and every other unfiltered stream) when asked.
- **Every change rewrites the whole file.** That is what makes a revision a plain PDF that can be
  reopened and checked, and it is why an annotation carries `/NM` to keep its identity across the
  rewrite. Byte-level incremental update is not used, and PaperForge does not claim it.
- **Page labels split into `/Kids`** — which only a very long document has — are replaced rather
  than merged when numbering is changed.
- **A change is not written to disk until saved.** The working copies in the session directory are
  what a crash leaves behind for the recovery screen; recovering _unsaved changes_ from them is not
  implemented yet — the journal records that a document was dirty, and reopening it reopens the
  file as it is on disk.
