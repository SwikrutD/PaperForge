# Organizing pages

How the page grid changes a document, how pages leave it as new files, and what neither can do.

## One document, two ways of working

Organize Pages (`Ctrl+Shift+P`) replaces the reading view with a grid of every page. It is the same
document: the same loaded PDF, the same undo history, the same save. Closing the grid with **Done**
goes back to reading it, and a double click on a page goes back to reading _that_ page.

Pages are drawn as they come into view and released when they leave, so the grid of a long document
costs about what the navigation panel's thumbnails cost. Both use the same `PageThumbnail`.

The renderer keeps three things apart on purpose:

| File                    | Holds                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `organizeSelection.ts`  | pure arithmetic: what a modified click means, where a drop lands, how a split divides a document |
| `useOrganizeActions.ts` | composing each action into exactly one undoable transaction                                      |
| `organizeStore.ts`      | what is chosen, the page boxes of the current revision, which dialog is open                     |

## Choosing and moving

Click chooses; `Ctrl`-click adds or removes; `Shift`-click takes a range and keeps its anchor, so
growing the range again grows it from the same place; `Ctrl+A` chooses everything and `Escape`
chooses nothing. The arrow keys move a column or a row at a time, and `Shift` extends.

A drag is told from a click by distance — six pixels — and the pointer is captured, so the gesture
survives leaving the page it started on. The indicator appears in the gap the block would land in,
and the insertion point is counted in the document _as it stands_, which is what a gap between two
pages means. A drop that would leave every page where it is does nothing at all, and adds no undo
step. After a move the pages stay chosen where they landed, so they can be picked up again.

## The operations

All of them are `EditOperation`s applied by `src/pdf/mutate/pages.ts` behind `PdfMutationEngine`,
which means each one is a whole-document rewrite into a new revision, undoable, and invisible to the
file on disk until the document is saved.

| Action            | Operation                                                                  |
| ----------------- | -------------------------------------------------------------------------- |
| Rotate left/right | `rotatePages`                                                              |
| Delete            | `deletePages` — refused when it would empty the document                   |
| Duplicate         | `duplicatePages` — each copy lands directly after its original             |
| Drag, or move     | `movePages`                                                                |
| Insert blank page | `insertBlankPages` — the size of the page it follows unless told otherwise |
| Insert from a PDF | `insertPages`                                                              |
| Insert an image   | `insertImagePages` — centred, proportions kept, 36 pt margin               |
| Replace a page    | `insertPages` + `deletePages` in one transaction                           |
| Crop              | `cropPages`                                                                |
| Page numbering    | `setPageLabels`                                                            |

They work on a running list of page objects held by the caller rather than on indices asked of
pdf-lib, which does not invalidate its page cache when a page is removed. That bug — `getPage`
returning a page that had just been deleted — is why `PageContext` exists.

## Pages arrive by token

Another PDF, an image, or another open document is staged in the main process
(`stagedAssets.ts`), which hands back a token and the facts the renderer needs: how many pages are
on offer, or how big the image is. No document bytes cross IPC, and the renderer never learns a
path. An encrypted PDF is refused as a source, in plain words, because pdf-lib cannot read one.

Moving pages into another open tab stages _this_ document for _that_ one, inserts the chosen pages
at its end and removes them here. Two transactions, because undo belongs to the document it changed.

## Extract and split write files

Neither changes the document. `pageExport.ts` copies the chosen pages into a fresh document and
publishes each file the way a save does: a temporary file, an fsync, a reopen through the engine, a
qpdf check when qpdf is installed, and only then the rename. If one file of several fails, the error
says how many were written rather than implying all or nothing.

Extraction can remove the pages afterwards, but only once the files exist, and never when that
would leave the document with nothing. Splitting offers every N pages, explicit ranges, or
top-level bookmarks, and lists the pieces — names and pages — before writing any of them.

A name the renderer suggests is only a suggestion: `safeFileName` reduces it to a bare file name
with no directory parts, none of the characters Windows forbids and a `.pdf` extension, before it is
joined onto the folder the reader chose. The folder itself always comes from a native dialog.

## Page boxes

`pages:boxes` reads what each page declares — media, crop, bleed, trim, art, its rotation and the
number the document prints on it. A box the page does not declare is reported as `null` and shown as
"Not set", never as a copy of the media box, because that is the difference between a cropped page
and an uncropped one.

Cropping is expressed as margins from what each page currently shows, so pages of different sizes
crop together; pages that end up with the same rectangle share one operation. The crop box only
hides content and **Reset crop** puts the whole page back. Changing the media box as well is a
separate checkbox that says what it discards.

## Limits today

- **Bookmarks are not rewritten when pages move.** A destination points at a page object, so it
  follows that page through a reorder; a bookmark whose page is deleted is left pointing at nothing.
  Editing the outline is Segment 17.
- **Extracted and split documents carry no outline, no attachments and no form.** They carry the
  pages, the title and the author. Combining documents with their bookmarks is Segment 8.
- **Page labels are replaced, not merged, when the document's label tree uses `/Kids`** — which only
  a very long document does. Ordinary `/Nums` entries are kept, so numbering a preface does not
  throw away the numbering of the body.
- **Splitting by bookmark uses top-level bookmarks that resolve to a page**, in page order. A
  bookmark that points at a named destination PDF.js cannot resolve is not offered as a boundary.
- **The crop rectangle is numeric in the page grid.** Crop Pages in the viewer draws the frame on
  the page and applies the same margins; both share `src/shared/utils/cropBoxes.ts`. Bleed, trim
  and art boxes are shown but not edited.
- **Insertion takes the whole of the chosen document.** Choosing which of its pages to insert is
  part of the Combine workspace in Segment 8, which is where a file-and-range list belongs.
