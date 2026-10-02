# PaperForge Progress

## Current status

- Last completed segment: **17 — Accessibility and practical advanced tools**
- Next segment: **18 — Printing and Windows integration**
- Build status: `npm run package` succeeds; the end-to-end suite drives the built application
- Test status: 807 unit tests (72 files) and 165 Playwright end-to-end tests passing;
  typecheck, lint and format clean. qpdf 12.4.2 is installed on the build machine; the Protect
  walkthrough is still a manual step.

## Completed segments

- [x] 0 Repository foundation
- [x] 1 Fluent Workspace shell and command system
- [x] 2 File service, tabs, recovery architecture
- [x] 3 PDF.js viewer foundation
- [x] 4 Navigation panels and search
- [x] 5 Mutation engine, save pipeline, undo/redo
- [x] 6 Comments and annotations
- [x] 7 Organize Pages
- [x] 8 Create PDF and Combine Files
- [x] 9 Edit PDF: content model and text editing
- [x] 10 Edit PDF: images, links, layout content
- [x] 11 Forms and Fill & Sign
- [x] 12 OCR
- [x] 13 Conversion centre
- [x] 14 Protect, metadata, sanitize, attachments
- [x] 15 True redaction
- [x] 16 Compare, optimize, repair, crop
- [x] 17 Accessibility and practical advanced tools
- [ ] 18 Printing and Windows integration
- [ ] 19 Performance, polish, QA, release candidate

## Segment 0 — what landed

**Toolchain.** Electron 44 + Electron Forge 7 (Vite plugin) + Vite 8 + React 19 + TypeScript 6
(strict, four projects) + ESLint 10 (type-aware) + Prettier + Vitest 5.

Secure window and preload bridge, typed and schema-validated IPC, atomic settings with repair,
light/dark/system theme owned by the main process, local rotating log with secret redaction, the
Fluent Workspace tokens, and the hand-written app icon generator.

## Segment 1 — what landed

**Command system.** One registry (`src/renderer/commands`) backs the menu bar, left rail, command
palette, keyboard shortcuts and shell buttons. Commands declare their own availability and checked
state; duplicate ids and duplicate chords are refused, and an unknown or disabled command cannot be
executed.

**Shell.** Title bar, menu bar with command search, left rail, resizable and persisted side panels,
workspace and status bar, all six of them `F6` focus regions.

**Home screen, overlays, jobs.** Recent files from the local store, the tool catalogue, modal
dialogs with focus trap and restore, `Ctrl+K` palette, toasts, and the progress centre on a real
job store.

## Segment 2 — what landed

**Document sessions (main process).** `documentInspector` reads what a file itself can tell:
header version, trailer encryption marker, size, modified time, read-only state. `DocumentService`
turns that into a session with a working directory and a recovery journal, reuses the session when
the same file is opened again, watches the file for outside modification or deletion, and clears
its directory on close.

**Recovery.** A session directory exists exactly while a document is open, so whatever survives a
crash is what the recovery dialog offers back. A clean exit clears them all.

**Tabs and workspace (renderer).** A document store owning tabs, activation, reordering, close,
close others and close to the right; a tab strip with unsaved and changed-on-disk markers,
middle-click close and a context menu; a document view showing the real file facts and saying
plainly that page rendering is still to come.

**Ways in.** Native file picker (`Ctrl+O`), drag and drop onto the window, and the recent list,
which is now live — click to open, pin, remove, show in Explorer. Session restore reopens the
previous documents, subject to a setting in the Settings dialog.

**End-to-end tests.** Playwright drives the built application through the real main process: home
screen, opening a PDF, refusing a non-PDF, the tab and document view, closing, and reporting a file
that has since been deleted.

| Area         | Key files                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Main process | `services/documents/{documentInspector,documentService}.ts`, `services/recovery/recoveryJournal.ts`                                             |
| IPC          | `ipc/handlers/fileHandlers.ts`, `shared/schemas/document.ts`                                                                                    |
| Renderer     | `stores/documentStore.ts`, `components/shell/{TabStrip,FileDropZone}`, `components/workspace/DocumentView`                                      |
| Overlays     | `components/overlays/{ConfirmationDialog,RecoveryDialog}`                                                                                       |
| Controls     | `components/controls/{ContextMenu,Toggle}`                                                                                                      |
| Tests        | `tests/unit/main/{documentInspector,documentService,recoveryJournal}.test.ts`, `tests/unit/renderer/documents.test.tsx`, `tests/e2e/app.e2e.ts` |

## Segment 3 — what landed

**Document bytes.** A new `pfdoc://document/<session id>` scheme serves an open session's file to
the renderer with `Accept-Ranges`, so PDF.js fetches the trailer and the first page instead of
reading a large file end to end. Only sessions that are open resolve, and the renderer still never
learns a path.

**Engine layer.** `src/pdf/render` states the contract — page geometry, render a page, render a
text layer, list links — and `pdfjsEngine.ts` is the only file that imports PDF.js. The worker,
character maps, standard fonts and colour profiles are copied out of `pdfjs-dist` at build time and
ship with the application; nothing is fetched at runtime.

**Viewer.** A continuous, virtualized page column: only pages within a viewport-height band are
mounted, renders are cancelled when a page scrolls away or the zoom changes, and canvases render at
the device pixel ratio. Zoom (fit page, fit width, actual size, steps, `Ctrl+wheel`), view rotation,
page navigation and a page box, all reported in the status bar. View state lives with the tab.

**Layers.** Text layer aligned to the canvas for selection and copying; annotations with appearance
streams are drawn onto the page by PDF.js; link annotations become real buttons — internal
destinations scroll, external URLs are confirmed and opened by the main process, which accepts only
`http`, `https` and `mailto`.

**Encrypted documents.** A password prompt inside the renderer, which hands the password straight to
the engine in that process: never over IPC, never persisted, never logged. A wrong password says so
and asks again.

**Test fixtures.** `tests/fixtures/pdf.ts` builds deterministic PDFs byte by byte, including a
40-bit RC4 encrypted one. A Node test reads each with PDF.js and checks page count, text, rotation,
unusual page sizes and the password path; the end-to-end suite drives the real application.

| Area   | Key files                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Bytes  | `main/windows/documentProtocol.ts`, `main/services/documents/rangeHeader.ts`                                                            |
| Engine | `src/pdf/render/{types,pdfjsEngine}.ts`                                                                                                 |
| Viewer | `renderer/components/viewer/{PdfViewer,PdfPageView,ViewerToolbar,PasswordPrompt,usePdfDocument,viewerLayout}`                           |
| Tests  | `tests/fixtures/pdf.ts`, `tests/unit/shared/pdfFixtures.test.ts`, `tests/unit/renderer/viewerLayout.test.ts`, `tests/e2e/viewer.e2e.ts` |

## Segment 4 — what landed

**One document, many readers.** `PdfDocumentProvider` loads the active document once per window and
shares it, so the page column, the thumbnails, the outline, the layers and the search all work from
the same PDF.js document rather than opening the file several times.

**Panels.** Thumbnails render only while near the viewport and are released when they leave, for the
same reason the page column is virtualized. Bookmarks are shown as authored — nesting, bold, italic
and colour — and an entry that points nowhere is disabled with an explanation rather than silently
doing nothing. Attachments are a listing only, with a warning on executable and script extensions
and a note that PaperForge never opens one. Layers toggle optional content groups for the view, and
the panel says plainly that the change is not saved.

**Search.** `Ctrl+F` opens a find bar over the page column: match count, next and previous, match
case, whole words, highlight all, a results list with an excerpt per match, and behind the options
row a scope of this document or every open one, plus a page range. `F3` and `Shift+F3` step through
matches even while the find field has focus. The scan walks pages one at a time out of the worker
that already has the file open, publishes progress as it goes, and is abandoned the moment the query
changes; other documents are opened for the search and released again, and one that cannot be read
is named as skipped. Matches are drawn between the canvas and the text layer with multiply blending,
so the words stay readable and selectable underneath.

**Honesty about scans.** When the searched pages carry no text the bar says so instead of reporting
no matches, and it does not offer OCR, because OCR does not exist yet.

**Page labels and reading mode.** The page field shows the label the document prints on the page —
roman numerals for a preface — with the real position beside it, and accepts either a label or a
number. Reading mode (`Ctrl+Shift+R`) leaves only the title bar and the document; `Escape` returns.

**Three viewer bugs fixed on the way.** Writing the shared PDF-space-to-CSS conversion for highlights
exposed that link hotspots placed 90° and 270° pages wrongly, that a page carrying its own `/Rotate`
was laid out on its side because the rotation was counted twice, and that such a page was rendered
unrotated because PDF.js treats a viewport's rotation as the total, not an extra one. All three are
covered by tests.

**Fixtures.** The generated PDFs can now carry an outline, page labels, embedded files and an
optional content group, so the panels are tested against documents PaperForge owns end to end. The
end-to-end suite checks layer visibility by counting ink on the canvas.

| Area   | Key files                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Panels | `renderer/components/panels/{PagesPanel,BookmarksPanel,AttachmentsPanel,LayersPanel,LeftPanel}.tsx`                       |
| Search | `pdf/search/textSearch.ts`, `shared/utils/pageRange.ts`, `renderer/stores/searchStore.ts`, `renderer/components/search/*` |
| Viewer | `renderer/components/viewer/{pageGeometry,pageEntry,PdfDocumentContext,renderEngine}.ts(x)`                               |
| Tests  | `tests/unit/renderer/{pageGeometry,searchNavigation,findBar,pageEntry}.test.*`, `tests/e2e/navigation.e2e.ts`             |

## Segment 5 — what landed

**The write engine.** `src/pdf/mutate` states a `PdfMutationEngine` contract and implements it with
pdf-lib, the only file that imports it — the same arrangement the render engine has with PDF.js. It
rotates and deletes pages, leaves the document's own metadata alone rather than stamping PaperForge
as its producer, and refuses an encrypted document with a typed error instead of writing something
broken. The operation arithmetic sits apart from the library and is unit-tested on its own.

**Revisions as undo.** A change is applied in the main process and written as a whole new document
inside the session's working directory; the viewer is pointed at that file instead of the original.
Undo steps back by reading an earlier revision rather than by reversing an operation, so it cannot
drift from what was actually written. Revision 0 is a snapshot of the document as it was opened,
taken at the first change, which is what keeps undo and revert working after a save has replaced
the original. History is capped at 30 revisions or 512 MB, oldest first, and says when it has been
trimmed.

**The save pipeline.** Save, Save As and Save a Copy write through a temporary sibling that is
reopened — and inspected by qpdf when qpdf is installed — before it replaces anything, so a file
PaperForge cannot read back is never published and a failed save leaves the original untouched. A
save over the original refuses a read-only file (pointing at Save a Copy) and a file that changed
on disk (unless the reader says overwrite). Revert goes back to the saved revision and can itself
be undone.

**qpdf, optional and found rather than required.** A configured path, then a copy staged in the
application, then the PATH. Missing means saved files are not double-checked, not that saving
fails. It is launched from one main-process wrapper with an argument array and no shell, a
cancelled run kills the child, and its exit codes are read properly: 3 is warnings, which plenty of
good PDFs produce and which does not block a save.

**In the workspace.** Rotate Page, Delete Page, Undo, Redo, Save, Save As, Save a Copy and Revert
to Saved are commands with the usual chords, so menus, palette, keyboard and the new toolbar group
share one implementation and one answer about what is possible. Page rotation sits apart from view
rotation because they are different things. The viewer reloads on a revision change, the tab's
unsaved marker follows the same state, and saving no longer looks like somebody else editing the
file.

**Settings → Local tools** reports whether qpdf was found, where and which version, with a native
picker to point at another one or go back to looking automatically.

| Area     | Key files                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Engine   | `src/pdf/mutate/{types,operations,pdfLibEngine}.ts`, `src/shared/schemas/edit.ts`                         |
| Pipeline | `main/services/documents/{documentEditor,revisionHistory}.ts`, `main/services/qpdf/qpdfService.ts`        |
| IPC      | `main/ipc/handlers/editHandlers.ts`                                                                       |
| Renderer | `renderer/stores/documentStore.ts`, `renderer/commands/*`, `renderer/components/overlays/QpdfSetting.tsx` |
| Tests    | `tests/unit/main/{documentEditor,revisionHistory,qpdfService}.test.ts`, `tests/e2e/editing.e2e.ts`        |

## Segment 6 — what landed

**Real annotations.** Every comment is an annotation dictionary in the page's `/Annots` with the
entries its subtype is defined by — quad points, ink lists, vertices, line coordinates, callout
lines — plus author, subject, dates, colours and an appearance stream PaperForge draws itself. What
a reader sees comes from the file rather than from each viewer's idea of what the mark should look
like, and a highlight multiplies with the page so the words stay readable.

**The tools.** `Ctrl+M` shows them: highlight, underline, strikethrough and squiggly from selected
text; sticky notes, text boxes and callouts; rectangle, ellipse, line, arrow, polygon and polyline;
freehand ink with an eraser; the built-in stamps and an image stamp. Text markup is taken from the
browser's own selection rectangles, so it lands on the glyphs rather than near them.

**Reading what is there.** Annotations are read back out of the file, so a document marked up in
another application lists properly, with its authors and text. One PaperForge cannot redraw is
still listed and can still be deleted — marked as not editable rather than hidden or silently
replaced.

**The comments panel** sorts by page, date or author and filters by type, author and status. A
comment can be written on in place, gone to, marked done or deleted. The properties panel edits the
selected mark — colour, opacity, line width and dash, fill, font size, text colour — or sets what
the next one will look like.

**Identity and geometry.** `/NM` carries a PaperForge id, so a mark keeps its identity through the
whole-file rewrite every change makes. `/RD` records the difference between the annotation
rectangle and the shape inside it, without which a read-modify-write cycle grew every shape by its
stroke width.

**Image stamps** are chosen through a native picker and staged in the main process: the bytes never
cross IPC, only a token and the size to place the stamp at.

| Area     | Key files                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Model    | `src/shared/schemas/annotation.ts`                                                                                    |
| Engine   | `src/pdf/mutate/annotations/{geometry,appearance,write,read,text,pdfDate}.ts`                                         |
| Main     | `main/services/documents/stampImages.ts`, `documentEditor.annotations`                                                |
| Renderer | `renderer/stores/annotationStore.ts`, `renderer/components/annotations/*`                                             |
| Tests    | `tests/unit/shared/annotation*.test.ts`, `tests/unit/renderer/annotationDrawing.test.ts`, `tests/e2e/comments.e2e.ts` |

## Segment 7 — what landed

**The page grid.** `Ctrl+Shift+P`, the Tools menu or the Organize Pages card replaces the reading
view with every page of the document, drawn as it comes into view. Pages are chosen with a click,
`Ctrl`-click, `Shift`-click, `Ctrl+A` and the arrow keys, and moved by dragging, with an indicator
in the gap the block would land in. A drop that would change nothing adds no undo step.

**The operations.** Rotate, delete, duplicate, move, insert a blank page, insert the pages of
another PDF, insert an image as a page, replace a page, crop, and page numbering — each composed in
one place (`useOrganizeActions.ts`) into a single undoable transaction, and applied by
`src/pdf/mutate/pages.ts` behind the mutation engine. They work on a running list of page objects,
because pdf-lib does not invalidate its page cache when a page is removed.

**Extract and split write files, they do not change the document.** `pageExport.ts` copies the
chosen pages into a fresh document and publishes each file through the same atomic write, reopen and
qpdf check a save uses; if one of several fails, it says how many were written rather than pretending.
Extraction can remove the pages afterwards, but only after the files exist, and never when that
would leave the document empty. Split offers every N pages, explicit ranges, and top-level
bookmarks, and lists the pieces before writing any.

**Pages between documents.** Moving pages into another open tab stages this document's bytes in the
main process, inserts the chosen pages there and removes them here — two transactions, because undo
belongs to the document it changed.

**Page boxes.** `pages:boxes` reads what each page declares — media, crop, bleed, trim, art,
rotation and the number the document prints — and the properties panel shows them while the grid is
open, saying "Not set" rather than repeating the media box. Cropping insets what each page shows by
margins, so pages of different sizes crop together; changing the page size itself is a separate
choice that says what it discards.

| Area     | Key files                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model    | `src/shared/schemas/pages.ts`, page operations in `src/shared/schemas/edit.ts`                                                                                 |
| Engine   | `src/pdf/mutate/pages.ts`, `src/pdf/mutate/extract.ts`, `src/shared/utils/pageLabels.ts`                                                                       |
| Main     | `main/services/documents/{pageExport,stagedAssets}.ts`, `main/ipc/handlers/organizeHandlers.ts`                                                                |
| Renderer | `renderer/stores/organizeStore.ts`, `renderer/components/organize/*`, `renderer/components/pages/*`                                                            |
| Tests    | `tests/unit/shared/pageOperations.test.ts`, `tests/unit/renderer/organizeSelection.test.ts`, `tests/unit/main/pageExport.test.ts`, `tests/e2e/organize.e2e.ts` |

## Segment 8 — what landed

**One interface for every way in.** `ConversionProvider` (`src/conversion`) is what a file type
means to PaperForge: the extensions it covers, whether it can run at all, and how it becomes pages.
Four are registered — PDF, images, text files, and local web pages through Chromium's own printing
— and local Office conversion joins the same list in Segment 13 without anything else changing.

**Files are staged, never uploaded.** A file chosen in the native picker is read by `SourceLibrary`
in the main process, converted by its provider, and kept as PDF bytes belonging to the window that
added it. The renderer arranges names, kinds and page counts; it previews each source over the
document protocol, so the first page is drawn without the bytes ever crossing IPC.

**The workspace.** One screen answers both "create a PDF" and "combine files": add files, order
them, take a page range from each, turn them, and say what the result is called. Changing the paper
converts the staged files again, because for a file that has already become pages that is the only
thing changing the paper can mean.

**Bookmarks survive.** `outline.ts` reads a source's outline as page indices — resolving direct
destinations, `/GoTo` actions and both kinds of named destination — translates them to where those
pages landed, and writes the tree again. An entry whose page was not taken is dropped and its
children take its place. A top-level bookmark per file is optional, and nests the carried ones
underneath.

**Web pages are printed, not run.** The page loads in a window with its own empty session, no
scripting, no node, and every request that is not the local file refused, then Chromium prints it.

**Publishing is the save pipeline.** Everything written — blank, combined, extracted or split — goes
through `publishDocument`: temporary sibling, flush, reopen through the engine, qpdf check when it
is installed, then rename. PaperForge opens what it wrote.

| Area      | Key files                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Model     | `src/shared/schemas/create.ts`, `src/conversion/models/provider.ts`                                       |
| Engine    | `src/pdf/create/{documents,combine,outline,paper}.ts`, `src/pdf/text/layout.ts`                           |
| Providers | `src/conversion/providers/localProviders.ts`, `main/services/conversion/htmlProvider.ts`                  |
| Main      | `main/services/creation/{sourceLibrary,documentCreator}.ts`, `main/services/documents/publishDocument.ts` |
| Renderer  | `renderer/stores/createStore.ts`, `renderer/components/create/*`                                          |
| Tests     | `tests/unit/shared/{createDocuments,combineDocuments}.test.ts`, `tests/e2e/create.e2e.ts`                 |

## Segment 9 — what landed

Recorded as the subsegments `CLAUDE.md` asks for; all six are done.

**9A — the content model.** PaperForge reads a page's drawing itself
(`src/pdf/content`): a parser that records where every operand begins and ends, a state machine
that follows the transform, the text state and the fill colour, and a text model that turns each
show operation into a run — what it says, where its baseline starts, how wide it is, which font
drew it, and the bytes that hold its text. Fonts come from the page's own resources: encodings,
`/Differences`, `ToUnicode` CMaps (read with the same parser, because a CMap is written the same
way), simple and composite widths, and the metrics of the standard fourteen for fonts that state
none. Inline image data is stepped over rather than parsed, a comment is whitespace, and a damaged
stream yields the operations before the damage.

**9B — selection.** `Ctrl+E` puts a box around every run, in the right place at the right size,
because the boxes come from the same geometry the page was drawn with. The properties panel names
the font, size, colour and position, and says whether the text can be rewritten.

**9C — the native rewrite (Tier A).** A change replaces only that run's own operand; the bytes
around it are copied through untouched. A `TJ` array is written back as one string. The run keeps
its starting point whatever its new length, so what follows moves exactly as the stream's own
positioning says it should.

**9D — the replacement (Tier B).** When the font cannot write what was typed, the run is
neutralised — `[ n ] TJ` draws nothing and advances just as far — and the text is drawn again in a
standard font at the same transform, size, colour and spacing. The reader is asked first, with the
character that stopped the rewrite named. Text PaperForge drew is named `PF…` in the resources, and
the panel says so.

**9E — adding text and choosing its look.** **Add text** puts new text where the page is clicked.
The panel chooses the family, weight, size and colour PaperForge draws with — the standard fourteen
fonts, so nothing is embedded and no font is redistributed.

**9F — the regression suite.** Ten cases of content that breaks naive editors: marked content, a
transform that moves and turns the text, spacing operators, several runs on one line, an inline
image before the text, a page with no text at all, a run that no longer exists, and a document
edited a dozen times over.

| Area     | Key files                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Model    | `src/pdf/content/{parser,state,textRuns,fonts,encodings,pageContent}.ts`                                      |
| Editing  | `src/pdf/content/{editText,drawText}.ts`, `src/pdf/mutate/{text,textResources}.ts`                            |
| Shared   | `src/shared/schemas/text.ts`, the `editText`, `replaceText` and `addText` operations                          |
| Main     | `main/ipc/handlers/textHandlers.ts`                                                                           |
| Renderer | `renderer/stores/textEditStore.ts`, `renderer/components/edit/*`                                              |
| Tests    | `tests/unit/shared/{contentParser,textRuns,editText,textEditRegression}.test.ts`, `tests/e2e/editText.e2e.ts` |

## Segment 10 — what landed

**Images.** A page draws an image by mapping the unit square onto the page and saying `Do`, so
every edit is one matrix. The `Do` is replaced where it stands with `q [/PFAlphaNN gs] M cm
[clip] /Name Do Q`, where `M` cancels the transform the page had already built up. Editing in
place is what keeps the drawing order: appending would lift the picture in front of whatever used
to cover it. Move, resize, turn, mirror, crop, opacity, replace, delete, add and write-out are all
built on that one rewrite, and the crop and the opacity are read back out of the page so neither
is cumulative and the panel reports what the page does.

Writing an image out hands back a JPEG untouched and otherwise encodes the samples as a PNG, with
a small dependency-free encoder (stored deflate blocks) in `imageResources.ts`.

**Links.** `/Link` annotations, read with where each one goes. PaperForge writes a page
destination or an `http`, `https` or `mailto` address and refuses anything else before writing;
a launch action or document JavaScript already in the file is described to the reader, never
followed and never rewritten unless they point the link somewhere new.

**Page furniture.** Watermarks, backgrounds, headers and footers are wrapped in marked content
named after what they are (`/PFWatermark BMC … EMC`), so PaperForge can find its own work: a
second watermark replaces the first rather than stacking, and Remove leaves the page underneath
byte for byte as it was. Headers and footers are written with tokens — `{{page}}`, `{{pages}}`,
`{{date}}`, `{{title}}`, `{{bates}}` — resolved page by page, with Bates numbering as a prefix, a
padded count and a suffix.

**The editor points at one thing at a time.** Text, images and links each have their own layer and
panel, and one shared target decides which takes the pointer — so a click on a caption printed over
a photograph is never a guess about which was meant.

| Area     | Files                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Model    | `src/pdf/content/{images,editImage,furniture}.ts`                                                                                       |
| Engine   | `src/pdf/mutate/{images,imageResources,links,furniture}.ts`                                                                             |
| Shared   | `src/shared/schemas/{image,link,furniture}.ts`, the image, link and furniture operations in `edit.ts`                                   |
| Main     | `main/ipc/handlers/{imageHandlers,linkHandlers}.ts`                                                                                     |
| Renderer | `renderer/stores/{imageEditStore,linkEditStore,editTargetStore}.ts`, `renderer/components/edit/**`                                      |
| Tests    | `tests/unit/shared/{editImages,editLinks,furniture}.test.ts`, `tests/unit/renderer/imageGeometry.test.ts`, three new `tests/e2e` suites |

## Segment 11 — what landed

**Reading and filling.** The whole form is read at once, because a field can be drawn on several
pages: what each field is, what it holds, what it will accept, where it is drawn, and whether it
carries an action PaperForge will not run. Filling writes through the field's own type — text cut
to its limit, an option the field does not offer refused, a read-only field left alone — and draws
the appearance of the fields that changed, so a reader that generates none of its own still shows
what was filled in.

**In the window**, each widget is a real control where the field is drawn, and the page is rendered
without its widgets while filling, so a value is never shown twice. Typing is held until the field
is left; ticks and choices are written at once. Changes go through a queue and the form is read
again after each, so a total is never worked out from what the form held a moment ago.

**Rules without scripts.** A field can be told to take a number or a date, and to work out the sum,
product or average of other fields. It is kept in the field's own dictionary under `/PFRule` and
PaperForge does the arithmetic itself: it writes no JavaScript into a document and runs none.

**Simple signatures.** Drawn, typed or brought in as a picture, cropped to the mark, and placed as
a stamp annotation so it can be moved and taken off like any other. An imported photograph has its
paper cleared away. A typed mark is rasterised with a face this computer already has, so no font is
embedded. Signatures are kept only when the reader asks, only on this computer, and are cleared
from Settings -> Privacy. Today's date goes on as text rather than a picture.

**Prepare Form.** A mode for making the form rather than filling it: pick a kind, drag where it
goes, name it and say what it accepts. Fields move, resize and go away; renaming makes the field
again under the new name, and is refused on a field carrying an action.

**Flattening** draws the fields and marks onto the page and takes them away, using the appearance
each already carries, and writes a copy by default.

| Area     | Files                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Engine   | `src/pdf/forms/{read,write,author,rules,flatten}.ts`                                                 |
| Shared   | `src/shared/schemas/{form,signature}.ts`, the field, flatten and authoring operations in `edit.ts`   |
| Main     | `main/ipc/handlers/{formHandlers,signatureHandlers}.ts`, `main/services/signatures/signatureLibrary` |
| Renderer | `renderer/stores/{formStore,signatureStore}.ts`, `renderer/components/forms/**`                      |
| Tests    | `tests/unit/shared/{forms,formRules}.test.ts`, `tests/e2e/{fillForm,signatures,prepareForm}.e2e.ts`  |

## Segment 12 — what landed

**The pipeline.** The window renders a page with PDF.js at the chosen resolution and hands the
picture to the main process; the main process runs the local Tesseract binary against local
language data and hands back the words with the boxes they were read from. Pages go one at a time,
so a long document never has more than one picture in flight.

**The words go on invisibly.** Each one is drawn in rendering mode 3 — which paints nothing — at
the box it came from and stretched to that box's width, so selecting, searching and copying all
work while the page still looks exactly like the scan it is. The layer is marked `/PFOcr`, so a
page read again replaces its words rather than gathering a second set, and a page read to nothing
loses the old ones.

**Nothing is downloaded.** Not the binary, not the language data, not at any point. Tesseract is
found where it was installed or where the reader points; language packs are folders on this
computer, and the dialog says so.

**Stopping is safe.** Cancelling stops before the next page and keeps every page already read, so
running it again finishes the rest.

| Area     | Files                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| Engine   | `src/pdf/ocr/{textLayer,apply}.ts`                                                         |
| Main     | `main/services/tesseract/{tesseractService,tsv}.ts`, `main/ipc/handlers/ocrHandlers.ts`    |
| Shared   | `src/shared/schemas/ocr.ts`, the `addRecognisedText` operation, the `ocr` settings section |
| Renderer | `renderer/stores/ocrStore.ts`, `renderer/services/ocrRender.ts`, `renderer/components/ocr` |
| Tests    | `tests/unit/shared/ocr.test.ts`, `tests/e2e/ocr.e2e.ts`, `tests/fixtures/scans.ts`         |

## Segment 13 — what landed

**Exporting.** Eight formats: PNG, JPEG and WebP pictures; text; a web page; Word; Excel;
PowerPoint. It runs the way OCR does — the window draws and reads a page at a time, the main
process writes the files — so only one page is ever in flight and a three-hundred-page document
costs no more memory than a one-page one. The reader chooses the destination first, so a dismissed
dialog costs nothing, and a stopped run keeps the pictures already written.

**Every mode says what it carries.** A picture keeps the page and none of its words; a document
export keeps the words and lays them out again from a reading of where they sat. That reading —
lines from shared baselines, paragraphs from the gaps, tables only where several rows break at the
same places — is its own module with tests that say where it should refuse rather than guess.

**Office documents** convert through a local LibreOffice, run headlessly with a profile of its own
so a copy the reader has open keeps working. Without it, an Office file is refused with a reason
that also says nothing would have been uploaded.

**Honest about scans.** Exporting the words of a document whose first pages carry none offers
Recognize Text rather than writing an empty file.

| Area     | Files                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Analysis | `src/conversion/analysis/layout.ts`                                                                        |
| Main     | `main/services/conversion/{writers,exportSession,libreOffice}.ts`, `main/ipc/handlers/convertHandlers.ts`  |
| Shared   | `src/shared/schemas/convert.ts`, the `tools.libreOfficePath` setting                                       |
| Renderer | `renderer/stores/exportStore.ts`, `renderer/services/exportRender.ts`, `renderer/components/convert`       |
| Tests    | `tests/unit/shared/exportLayout.test.ts`, `tests/unit/main/libreOffice.test.ts`, `tests/e2e/export.e2e.ts` |

## Architecture decisions

1. **Channel allowlist separate from schemas**, so the preload carries no validation library and
   the two cannot drift.
2. **IPC never rejects**: handlers resolve an `IpcResult` envelope and the renderer rethrows a typed
   `AppError`. Requests, responses and events are each schema-validated.
3. **`app://` scheme instead of `file://`** for the packaged renderer: a real origin, a CSP the
   protocol handler attaches itself, and traversal-protected paths.
4. **Main process owns theme resolution**, so "Follow system" stays correct at runtime.
5. **CommonJS main and preload**, because sandboxed preload scripts cannot be ES modules.
6. **Four TypeScript projects** with different libs and globals, plus lint rules keeping Node APIs
   out of the renderer.
7. **Deny-by-default packaging**: only build output, `package.json` and the notices reach the asar.
8. **Electron fuses on**: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no CLI inspect arguments,
   cookie encryption, asar integrity, load-only-from-asar.
9. **Hand-written icon generator** — no image tooling, no network.
10. **TypeScript 6.0.3, not 7.x**, so type-aware lint rules keep working.
11. **Fluent UI React Components still not installed**; the tokens stay framework-neutral.
12. **Squirrel maker deferred to Segment 18.**
13. **Only working commands are registered**, so a menu or the palette can never offer something
    PaperForge cannot do.
14. **The tool catalogue is the one place planned tools are visible**, as clearly disabled cards;
    the tools panel lists only usable tools.
15. **Panel geometry lives in settings**, with local state only for the duration of a drag.
16. **The main process owns full screen**, so the renderer and the window cannot disagree.
17. **Opening is read-only and identified by content.** A file is a document only if it really
    starts with a PDF header; the extension is not trusted. PaperForge never writes to the file it
    opened.
18. **Commands live in the renderer**, not `shared/commands`, because every implementation is
    renderer-side.
19. **A session directory is the crash signal.** It exists exactly while a document is open, so
    recovery needs no heartbeat, no lock file and no "was I closed properly" flag — anything left on
    disk at startup was left by a crash.
20. **Opening the same file twice reuses its session**, so two tabs can never disagree about one
    document. Duplicate views of one document (spec section 8) will be a view concern, not a second
    session.
21. **The renderer owns tab order and activation; the main process owns sessions.** `files:list`
    lets a window that has just loaded pick up sessions that already exist, which is also how a
    second window and a reload stay correct.
22. **Drag and drop resolves paths through `webUtils` in the preload.** Chromium removed
    `File.path`; a file that yields no path gets an explanation rather than silence.
23. **Document bytes travel over their own scheme, not IPC.** A large PDF would otherwise have to
    be copied through the IPC boundary; `pfdoc` streams it with range support, and the renderer asks
    for a session id rather than a path.
24. **Nothing above `src/pdf/render` imports PDF.js.** The viewer is written against an interface,
    so a second engine can be added later without touching the UI, and the layout arithmetic can be
    unit-tested without a browser.
25. **Virtualization is the memory budget.** Only pages near the viewport hold a canvas; the rest
    keep their space and nothing else. A canvas cache for recently seen pages can come later if
    profiling asks for it, but the bound is structural rather than a number to tune.
26. **Fit width fits the widest page.** Fitting only the current page made a document that mixes
    portrait and landscape scroll sideways; this way the column never does.
27. **A document password never leaves the renderer.** It goes from the prompt straight into the
    PDF engine in the same process.
28. **The product version is injected at build time.** An unpackaged run has no `package.json`
    beside the bundle, so `app.getVersion()` reported Electron's version in development.
29. **End-to-end tests drive the unpackaged build.** The inspector fuse that protects the packaged
    application also blocks a test runner, so Playwright launches the same bundle with the Electron
    binary and the packaged build is smoke-tested separately.

30. **One PDF.js document per window, shared by everything.** The panels live outside the workspace
    in the shell, so the provider sits above both rather than the viewer owning the document.
31. **Search state is a store, not a context.** A command, a shortcut, the find bar and the page
    highlights all act on the same search, and the query survives switching tabs.
32. **The scan is incremental and abandonable.** Text is pulled a page at a time from the worker
    that already has the file open, results are published as they are found, and a changed query
    cancels the run instead of queueing another.
33. **One tested conversion for PDF-space rectangles.** `pageGeometry.ts` mirrors the transform
    PDF.js builds for a viewport, so link hotspots, search highlights and everything that follows
    place rectangles the same way — including the page's own rotation, a view box that does not
    start at zero, and the user unit.
34. **A function key is an application shortcut even while typing.** `F3` has to keep stepping
    through matches when the find field has focus; bare printable keys are still suppressed.
35. **Reading mode is not persisted.** It is a way to read, not a preference, so it lives in the UI
    store and `Escape` leaves it.
36. **Match rectangles assume even character widths within a text run.** That is exact for
    monospaced text and close enough elsewhere for a highlight; the rectangles are never used for
    anything but drawing.

37. **Undo is a stack of documents, not of inverse operations.** Each change writes a whole
    revision into the session directory and undo reads an earlier one. It costs disk and a rewrite
    per change; it buys an undo that cannot corrupt a document by failing to reverse an operation
    exactly, which for PDF content streams is the likelier failure.
38. **Revision 0 is written at the first change, not at open.** Opening stays free, and the
    document as it was opened survives a save that replaces the original file.
39. **Only the main process writes.** The renderer composes transactions in terms of pages; the
    main process owns the bytes, the temporary files and the sidecar. The renderer still never
    learns a path.
40. **The revision is part of the document URL.** A change asks the viewer for a document it has
    not seen, which is a cleaner reload than invalidating a cache.
41. **A save is published only after it has been read back.** The atomic write gained a validation
    hook that runs between flush and rename, so the reopen — and the qpdf check — happen while the
    destination is still untouched.
42. **qpdf is a second opinion, not a dependency.** PaperForge validates its own output; qpdf makes
    that check stronger when it is installed. Its absence is stated plainly and changes nothing
    else.
43. **Encrypted documents are refused for editing, not mangled.** pdf-lib cannot decrypt, and the
    password the viewer holds stays in the renderer. Decryption belongs with the qpdf-based
    security tools in Segment 14.
44. **pdf-lib's page cache is not to be trusted after a removal.** It is not invalidated by
    `removePage`, so the engine holds pages by identity and keeps the running order itself.

45. **A comment is a PDF annotation, not a record in an application store.** Everything PaperForge
    shows about a comment comes from the file, which is why a document marked up elsewhere reads
    correctly and a document marked up here reads correctly elsewhere.
46. **PaperForge writes the appearance itself.** Relying on each reader to synthesise one means the
    mark looks different everywhere; an `/AP` stream means it does not.
47. **The renderer never draws the finished mark.** It draws what does not exist yet — the shape
    being dragged, the selection outline, the hit areas — and the page comes from the engine. Two
    drawing implementations would be two things to keep in step.
48. **Text markup comes from the browser's selection rectangles.** The text layer already knows
    exactly where the glyphs are; anything else would be a guess at word boundaries.
49. **The pointer layer has three modes, not two.** Drawing takes the pointer for itself; erasing
    and selecting leave it on the marks, because both act on what is already there.
50. **The resolved flag is PaperForge's own.** PDF has no portable place for it, so it is written
    to `/PFStatus` and the panel says other readers ignore it.
51. **An annotation PaperForge cannot redraw is listed, not hidden.** Its text and status can still
    be changed and it can be deleted; its appearance cannot, because redrawing it would mean
    replacing a mark PaperForge does not understand.
52. **Organizing pages is a workspace, not a panel.** The grid replaces the reading view and shares
    the document, the undo history and the save with it, rather than being a second view of a second
    copy. The navigation panel keeps its thumbnails for reading.
53. **Extract and split are file-producing services, not document changes.** They copy pages into a
    new document in the main process and publish each file the way a save does. Nothing about the
    document the pages came from changes, so neither belongs in its undo history.
54. **The renderer decides which pages a split contains; the main process decides what a file is
    called.** Ranges, every-N and bookmark boundaries are the renderer's arithmetic, so "split by
    bookmark" reuses the outline PDF.js has already read; a suggested name is reduced to a bare file
    name before it is joined onto the folder the reader chose.
55. **Pages arrive by token, never as bytes.** Another PDF, an image, or another open document is
    staged in the main process and referred to by a token, so no document content crosses IPC and the
    renderer never learns a path.
56. **Cropping is expressed as margins.** One rectangle cannot crop pages of different sizes
    sensibly; margins can, and they are measured from what each page currently shows. Pages that end
    up with the same rectangle share one operation.
57. **A zustand selector must return what the store holds.** Filtering or mapping inside one makes a
    new array on every render, which React reads as a new snapshot and renders again — the toolbar's
    list of other open documents hit exactly that and is now derived with `useMemo`.
58. **Every way into PaperForge is a `ConversionProvider`.** Images, text and web pages today, local
    Office conversion in Segment 13. A provider states whether it can run, so a missing local
    component is a sentence the reader can act on rather than a silent failure.
59. **A source is converted when it is added, not when it is used.** That is what makes a page count,
    a preview and a page range possible before anything is written, and it is why changing the paper
    converts the staged files again.
60. **Staged files belong to a window.** Two windows cannot see each other's list, and a window's
    list goes when it closes. The renderer refers to a source by an id it was given; it cannot name
    a file.
61. **The document protocol serves staged sources too**, so previewing a file that is not open uses
    the same path — and the same range support — as reading one that is.
62. **Web pages are printed by Chromium, in a window that can reach nothing.** No scripting, its own
    empty session, every non-file request refused. A local HTML file is as untrusted as a PDF.
63. **Creating and combining are the same workspace.** They differ only in what the reader came in
    for; one list, one set of options, one place where the arrangement lives.
64. **Bookmarks are carried as page indices.** A destination in the source means nothing in the
    result, so the outline is read as "which page", translated to where that page landed, and
    written again.
65. **PaperForge reads content streams itself.** PDF.js gives text for searching; editing needs to
    know _which bytes_ hold a run, which only a parser that records offsets can say. The parser is
    the foundation the text editor, and later the image editor, stand on.
66. **A run is named by the operation it came from.** `op12` holds for exactly one revision, because
    every change rewrites the page; the editor reads the page again after each change rather than
    patching the model it had.
67. **A text change replaces one operand, not the stream.** Everything around it is copied through
    byte for byte, so a page that PaperForge edits is otherwise the file it was.
68. **Replacing is offered, not imposed.** Letterforms change when a font is substituted, so the
    reader is asked, with the character that stopped the rewrite named. A run whose font says
    nothing about its codes is marked before they type a word.
69. **Neutralising beats painting over.** A covered rectangle hides whatever else is underneath and
    depends on the page's background; `[ n ] TJ` removes exactly the glyphs that were there and
    keeps the advance, so the rest of the line does not move.
70. **PaperForge draws with the standard fourteen fonts only.** Nothing is embedded, so no font is
    redistributed — and text outside Latin-1 is refused rather than drawn as question marks.

71. **Image edits are made where the image is drawn, never appended.** The `Do` is replaced with
    `q M cm … Do Q`, with `M` cancelling the page's own transform. Appending would change the
    drawing order and lift the picture in front of what used to cover it.
72. **Cropping is a clip, not a re-encode.** The picture keeps every pixel it arrived with, the
    crop can be taken off again, and reading the clip back is what stops a second crop compounding
    the first.
73. **Mirroring down is reported as mirroring across, turned half a circle.** They are the same
    matrix, and reporting one of them keeps what is read back equal to what was written.
74. **An object's name comes from where it sits in the page's content**, and every change rewrites
    that content — so after a change the editor finds the object again by where it is on the page
    and keeps it selected.
75. **Opacity is read from the page, not remembered.** It is a graphics state the resources name;
    the editor writes one beside the image and reads it back from the same place.
76. **Shapes stay annotations.** A shape drawn into the content stream could not then be selected
    or moved, only undone; the annotation tools already write real, selectable, printing shapes.
    Turning one into page content is what flattening is for, in Segment 11.
77. **PaperForge's own page furniture is marked with `BMC`**, not `BDC`: a tag with no property
    list is what it is, and `BDC` without its dictionary is malformed — PDF.js said so.
78. **The window resolves the date and the title for a header; the engine resolves the numbering.**
    Locales belong to the window, and only the engine knows which page is which.
79. **Text, images and links take the pointer in turn.** One shared target, three layers: the
    alternative is guessing which object a click on overlapping content meant.

80. **A form is read whole, not page by page.** A field can be drawn on several pages, and a form
    is small next to the document it sits on.
81. **The page is drawn without its widgets while a form is filled in.** Otherwise the canvas would
    show what a field holds and the control over it would show the same thing, half a line apart.
82. **Typing is held until the field is left; ticks and choices are written at once.** Every change
    makes a revision, and a sentence should be one undo rather than forty — but a control that
    waits for a round trip to show a tick feels broken.
83. **Form changes go through a queue, and the form is read again after each.** Two in flight at
    once would each work from what the form held before the other, and a total would come out
    wrong.
84. **A field's rule is PaperForge's own entry, not a script.** Acrobat writes calculations as
    document JavaScript; PaperForge will not run JavaScript, so it does not write any — it keeps
    the rule under `/PFRule` and does the arithmetic itself.
85. **A signature is a stamp annotation**, so it can be moved and taken off like any other mark, and
    flattening is what makes it part of the page.
86. **A typed signature is rasterised in the window.** It is drawn with a face this computer already
    has and goes into the document as a picture, so no font program is embedded or redistributed.
87. **Renaming a field makes it again under the new name**, because a name is where the field sits
    in the form's tree rather than a label on it — and it is refused on a field carrying an action
    PaperForge would have to drop.
88. **A rewritten stamp keeps the appearance it already had** when PaperForge has no picture to hand
    for it; only the rectangle moves. Redrawing it would turn a signature into an empty box.

89. **The window renders the page and the main process reads it.** PDF.js lives in the window and
    only the main process may run a program, so the picture crosses between them — one page at a
    time, as base64 in a validated payload.
90. **Recognised words are drawn invisibly over the picture, not in place of it.** A scan that has
    been read must still look like the scan it is.
91. **Each word is placed and stretched to the box Tesseract read it from.** A selection then
    follows the marks on the page rather than the font's own spacing.
92. **The recognised layer is marked like PaperForge's other furniture.** Reading a page again
    replaces the words rather than stacking them, and Remove can take them off.
93. **Orientation detection is asked for only when the data for it is installed.** Asking Tesseract
    for something it cannot do would only fail the run.
94. **A cancelled run keeps the pages it finished.** Recognition is page by page, and losing an
    hour's work to one click would be indefensible.
95. **Tesseract is not bundled.** It is a separate Apache-2.0 program; PaperForge finds it, says
    where it is, and says plainly when it is missing.

96. **An export streams a page at a time.** The window renders and reads; the main process writes.
    Gathering a whole document first would cost hundreds of megabytes for no gain.
97. **The destination is chosen before the first page is drawn**, so dismissing the dialog costs
    nothing and a picture export can keep what it has already written.
98. **A document export is a reading of the geometry, and says so.** There are no paragraphs in a
    PDF and no tables; every mode states what it carries before the reader picks it.
99. **A table is reported only where several rows break at the same places.** A wrong table is
    worse than no table, so a page of prose returns none.
100. **Excel writes no formulas.** PaperForge will not invent one from a total it has only read.
101. **LibreOffice is run, never bundled or modified.** It is a separate MPL-2.0 program the reader
     installs; PaperForge uses a profile of its own so their copy and settings are untouched.
102. **jszip, reached through the Office writers, is taken under its MIT option**, which is why no
     GPL package appears in the notices.

103. **Comparing is a workspace with its own copies of the documents.** It loads the two revisions
     itself, so the viewer's document — and its password, which the viewer keeps — is never
     disturbed, and comparing needs no document to be the active one.
104. **Pixels are compared in a worker and only rectangles are kept.** A hundred-page comparison
     would otherwise hold a gigabyte of pixels; the overlay picture is drawn again on demand for the
     pair on screen.
105. **A picture difference a text change explains is not listed.** A changed word redraws its own
     pixels; listing both would double every text change.
106. **Optimising produces a revision, not a file.** `DocumentEditor.applyBytes` makes qpdf's or the
     engine's output the next revision after reading it back, so optimising is undone like any
     edit and only Save writes the reader's file. A result that is not smaller is discarded.
107. **JPEG comes from Chromium, injected.** `nativeImage` decodes and encodes in memory with no new
     dependency; the engine takes the codec as a parameter, so it is tested without Electron.
108. **A picture is made smaller only when how large it is drawn was measured.** A picture used by
     an annotation's appearance, a pattern or a Type 3 glyph keeps every pixel.
109. **Repair writes a new file, and checking needs no sidecar.** The cross-reference check reads the
     table and the offsets it names, so a damaged file is reported without qpdf; the copy can
     never be written over the file that was opened.
110. **The crop tool and the page grid share one piece of arithmetic.** A frame is margins measured
     from what the page shows, which is what lets one frame crop pages of different sizes.

## Known limitations

- The viewer is continuous scrolling only. Single page, two-page spread, cover page, the hand and
  marquee-zoom tools and presentation mode are part of the fuller viewer in `CLAUDE.md` section 10
  and are not built yet.
- Changing a layer's visibility applies to the view; Save as default writes it into the document.
  Layers locked by the document are not shown as locked, and per-layer usage settings (print or
  export visibility) are not edited.
- Attachments are listed but cannot be saved, added or removed; that is Segment 14. No size is
  shown, because the listing PDF.js returns does not carry one.
- Bookmarks are moved with buttons and keys, not by dragging. Expanding and collapsing an entry in
  the panel is not written to the file (the operation exists; the panel does not use it). A
  bookmark goes to a page and a height on it, at the reader's zoom; PaperForge does not write other
  destination kinds, though it keeps them on entries it renames or moves.
- Search covers text. Searching bookmarks and annotations, and regular expressions, are not
  implemented; a query is matched literally, so punctuation searches for itself.
- A search stops collecting at 5,000 matches and says so rather than growing without bound.
- Search highlights are placed from text-run geometry, so on a run with unusual per-glyph spacing a
  highlight can be a fraction of a character out. It never affects what is found, only what is
  drawn.
- Word export writes paragraphs, headings and tab-separated table rows — not real Word tables,
  columns, or headers and footers.
- Excel export writes what looks like a table and a line a row where nothing does, with no
  formulas.
- PowerPoint's editable mode places text boxes where the words sat; complex layouts change.
- A web page export is a picture of each page with its words over it, not a reflowing rendering.
- Office conversion needs a local LibreOffice; without one those files are refused with a reason.
- Recognised words are drawn with the standard fourteen fonts, which cover Latin-1: a language
  whose script needs other characters is read but searchable only as far as that encoding reaches.
- PaperForge does not deskew or despeckle a scan. The optional cleanup is greyscale and contrast,
  and Tesseract's own orientation detection does the rest.
- Confidence is reported, not acted on: every word read goes on the page, and the dialog says how
  sure Tesseract was overall.
- Certificate-based signing, and the validation of one, are out of scope for v1: PaperForge places
  a visual mark and says as much wherever a reader might wonder.
- PaperForge runs no document JavaScript. A form that calculates with a script keeps it, untouched
  and unrun; PaperForge's own arithmetic is sum, product and average.
- A radio group's options are fixed when the field is made — each is a widget in its own right, so
  changing them means making the field again.
- A new field takes the border and fill colours `pdf-lib` gives it; the panel does not offer them.
- XFA forms are not supported. PaperForge reads the AcroForm underneath, which is what most such
  documents also carry.
- The encryption marker shown in the properties panel is still a trailer scan. The viewer knows the
  truth once a document is open, and the two are not yet reconciled.
- An image inside a form XObject is not listed, for the same reason text inside one is not: the
  editor reads the page's own content stream.
- A CMYK image cannot be written out yet; a JPEG comes out untouched and everything else is written
  as a PNG of its samples, which an indexed or ICC image will have in its own space rather than
  converted.
- A link can be pointed at a page or at an http, https or mailto address. Named destinations, launch
  actions and document JavaScript are described where they are found but cannot be authored, and
  PaperForge never follows them.
- A link's rectangle is axis-aligned: `/QuadPoints` on a rotated link is not authored.
- Page furniture is put on with a dialog and taken off with the same dialog. There is no listing of
  which pages already carry a watermark or a header; Remove simply takes off whatever PaperForge
  put on the pages chosen.
- A watermark sits in the middle of the page. The engine takes a position, and the dialog does not
  offer the other eight yet.
- Editing covers pages, comments, text, images, links and page furniture: rotate, delete, move,
  duplicate, insert, replace, crop and renumber pages; annotations; the text a page draws; the
  images it draws; the links it carries; and the watermarks, backgrounds, headers and footers
  PaperForge puts on. Form fields are Segment 11.
- Text editing rewrites a run in its own font where that works, and otherwise replaces it with text
  drawn in a standard font, with the reader asked first.
- PaperForge draws text with the fourteen standard fonts, which cover Latin-1. Cyrillic, Greek and
  CJK cannot be written yet: embedding a system font is `CLAUDE.md` section 13.4's work and is not
  built.
- Text inside a form XObject is not listed by the editor, which reads the page's own content
  stream. The toolbar says when it finds nothing it can edit on a page.
- A rewritten page's content is written as one uncompressed stream; compression belongs with the
  optimizer in Segment 16.
- Reflow is not attempted: a run keeps its position, and changing its length moves what follows it
  only as far as the stream's own positioning does. Paragraph reflow needs a block model, which is
  where multi-line text boxes will start.
- Bookmarks are not rewritten when pages move. A destination follows its page through a reorder,
  because it points at the page object; a bookmark whose page is deleted is left pointing at
  nothing. Editing the outline is Segment 17.
- Extracted and split documents carry the pages, the title and the author — not the outline,
  attachments or form. Carrying bookmarks across is part of Combine in Segment 8.
- Cropping is numeric. Dragging a crop frame on the page, and editing the bleed, trim and art
  boxes, belong with the crop and page-box tools in Segment 16.
- Inserting from another PDF in the page grid takes the whole of it; choosing which of its pages to
  take is what the Combine workspace does.
- Office documents cannot be made into PDFs yet: the provider interface is in place and the file
  dialog offers only what really works. Local LibreOffice lands in Segment 13, as does exporting a
  PDF to images, text, Word, Excel or PowerPoint.
- A staged source is converted once, when it is added. A file changed on disk afterwards is combined
  as it was; removing and adding it again picks up the change.
- Text files are set in Courier, a standard PDF font, so no font is embedded and no licence is in
  question. Choosing a font belongs with the text editor in Segment 9.
- A web page is converted without running its scripts, deliberately. A page that builds itself with
  JavaScript converts as the markup it shipped with.
- Staged sources are held in memory, which is why one file is limited to 512 MB and one window to
  500 files.
- A comment can be moved but not resized by handle: changing a shape's size means drawing it
  again. Text markup and ink are deliberately not resizable — one belongs to the words it marks,
  the other to the movement of the hand.
- Text in a text box, callout or stamp is drawn in Helvetica. The comment itself keeps whatever was
  typed, in full Unicode; the drawn appearance shows a question mark for a character Helvetica
  cannot draw.
- XFDF import and export is not implemented, so comments cannot be sent to or from Acrobat as a
  separate file. File attachment annotations wait for the embedded-file work in Segment 14, and
  measurement annotations for the practical tools in Segment 17.
- An encrypted document can be read but not changed, and says so.
- Every change rewrites the whole document. That is fine for page operations on ordinary files; a
  very large document and a rapid series of changes would be the first thing to batch.
- Unsaved changes are not recovered after a crash. The revisions are in the session directory and
  the journal records that the document was dirty, but the recovery screen reopens the file as it
  is on disk rather than offering the working copy. That is Segment 19 territory, and until then
  the honest description is "PaperForge knows a document had unsaved changes, not what they were".
- PaperForge does not claim byte-level incremental saving: pdf-lib rewrites the file. The internal
  recovery journal is the "incremental" of `CLAUDE.md` section 9.
- Nine of the fifteen home-screen tool cards are disabled because their capability is not built; a
  card whose tool exists but needs a document open says that instead.
- Tabs reorder by dragging or the context menu; there is no keyboard chord for reordering yet.
- The encryption marker is a trailer scan, not a parse. The viewer will confirm it properly.
- File watching uses `fs.watch`, which reports a change but not who made it; a file replaced by a
  rename is reported as modified.
- Tooltips use the native `title` attribute.
- `resources/bundled-tools` and `resources/tessdata` exist but are empty and git-ignored. qpdf,
  Tesseract and LibreOffice are not bundled; each is discovered locally or pointed at in Settings.
- Protecting a document needs qpdf. Without it the dialog explains that and does nothing else;
  reading a document's security needs nothing at all.
- A password is passed to qpdf on its command line when the document is being encrypted, because
  that is the only way qpdf accepts one for `--encrypt`. Another program on the same machine could
  read it from the process list for the moment qpdf runs. The input password for `--decrypt` goes
  on standard input instead. Neither is written to a log, a settings file or the recovery journal.
- PaperForge writes the permissions qpdf writes: printing, how much may be changed, copying, and
  reading by assistive software. The other permission bits are reported when a document carries
  them but are not offered as separate choices, because no tool sets them independently.
- 40-bit RC4 has only four permission bits, so the finer choices are folded into them rather than
  passed to a qpdf that would refuse the run.
- `openPasswordRequired` is worked out for the standard security handler at revisions 2 to 6. A
  document with some other handler reports it as unknown rather than guessing.
- Fonts are listed from the pages' own resources. A font used only inside a form XObject is not
  listed, for the same reason text inside one is not editable.
- The sanitizer removes hidden layers by taking the group out of the catalogue's listing; the
  marked content stays on the page and simply stops being optional. It is no longer revealable,
  but it is not deleted, and a page-level removal belongs with redaction in Segment 15.
- XMP is removed as a whole packet or left alone; PaperForge does not edit XMP, so it cannot keep
  the two copies of the metadata in step. Removing it is offered where the document carries one.
- Removing hidden information does not attempt to rewrite an incrementally-updated file's earlier
  revisions on its own — but every PaperForge save is a full rewrite, which is what leaves them
  behind. The dialog says so where the file has been written more than once.
- The Windows installer, file associations and "Open with" are not built (Segment 18); `npm run make`
  produces a zip.
- Prettier reformatted `CLAUDE.md` once during Segment 0 (whitespace only) before it was added to
  `.prettierignore`.

- Redaction marks are pending renderer state: they are not written into the file and are lost if
  the document is closed before they are applied. Applied redactions are an ordinary undoable edit
  until the document is saved.
- Redaction cuts the page's own content stream. Text or pictures inside a reusable group (form
  XObject) that a mark only partly covers, text in a font whose widths are unknown (Type 3, a
  non-standard font without `/Widths`, a non-Identity or vertical composite font), inline images,
  and JPEG, masked or predictor-compressed pictures only partly covered make that page a picture
  instead (200 dpi JPEG, marks painted on). Its text is then no longer selectable until Recognize
  Text is run. The review dialog lists such pages and the reason.
- A path that crosses the edge of a mark is painted over, not cut; only paths wholly under a mark
  are removed. Shadings and patterns are not cut.
- Redaction by area does not change bookmark titles or descriptions in a tagged document's
  structure tree (the review says so when present). Metadata and other hidden information are
  removed only when "Also remove hidden information" is chosen.
- Find text to mark searches the page's own text; it does not look inside reusable groups or read
  scans (those pages are reported, and can be marked by area or recognised first).
- A widget under a mark removes its whole form field, on every page, because the value belongs to
  the field.

- Compare pairs pages by position plus one offset; it does not find a page that moved further, and
  compares the words in the order PDF.js gives them, so a reflowed paragraph reads as changed text.
  Word boxes share a run's width by character, as search highlights do.
- A document that needs a password to open cannot be compared yet: the viewer keeps the password
  to itself and the comparison does not ask a second time.
- Pages are compared at no more than 1,400 pixels along their longer side; a change smaller than a
  few pixels at that size is not reported.
- Optimize does not subset, merge or remove fonts, and does not merge duplicate objects. Pictures in
  CMYK, indexed or Lab colour, JBIG2, JPEG 2000, colour-keyed or with a decode array are left
  exactly as they are, and are counted as such in the dialog.
- A grey picture re-encoded as JPEG is written as a colour JPEG, because Chromium's encoder writes
  colour; it is described as RGB and still looks grey.
- Optimizing runs in the main process; on a very large document the window waits for it, although
  it stays drawn. Fast web view is lost again by the next edit, which rewrites the file.
- A repaired copy is made from the revision being shown. qpdf cannot repair an encrypted document
  that needs a password to open.
- The crop frame is drawn on one page at a time; bleed, trim and art boxes are shown but not edited.

- The Accessibility Check reads structure; it does not certify anything, add tags, repair a tag
  tree, edit reading order or judge colour contrast. Alternate text is offered for `Figure` and
  `Formula` elements only. A figure is located by the page content its marked-content identifiers
  own; content drawn inside a group under its own identifiers is not located. The title fix writes
  the information dictionary and leaves an XMP title as it was.
- "Text outside the tags" counts show operations outside marked content on the page itself; text
  drawn inside a group is not checked. Image-only pages are judged by counting: a page that paints a
  picture and shows no text at all.
- Measurements use one rectilinear scale per document for as long as it is open; a page's own
  viewport measure dictionaries (`/VP`) and `/UserUnit` are not read. Angles, radius and
  geographic (`/GEO`) measures are not offered. A measurement can be moved and restyled; its
  scale is fixed when it is made.

## Segment 14 — what landed

**Document Properties.** `src/pdf/metadata/` reads the information dictionary, the custom entries
beyond the standard ones, the fonts the pages name, the page sizes with rotation applied, the
language, whether the document is tagged and whether it is laid out for fast web view. Writing goes
through two new edit operations — `setMetadata` and `setDocumentLanguage` — so renaming a title is
undoable and is not on disk until the document is saved. A cleared field removes the entry rather
than writing an empty one, and text is written as UTF-16 so a title with an accent survives.

**Security, read without a sidecar.** `src/pdf/security/` parses the encryption dictionary straight
out of the bytes, which works on a document nothing can open, because that dictionary is never
itself encrypted. `standardHandler.ts` implements enough of the standard security handler —
algorithm 2 and 6 for revisions 2 to 4, algorithm 2.B for revision 6 — to answer the one question
the dictionary does not state: is a password needed to _open_ this document, or only to change it?
That distinction is what the Protect dialog leads with. Nothing here decrypts anything; it
validates the empty password and stops.

**Security, written through qpdf.** `QpdfSecurity` builds `--encrypt` and `--decrypt` argument
arrays — never a shell string — and hands the input password on standard input where the installed
qpdf supports `--password-file` (10.2 and later). Argument spelling changed at qpdf 11, so both
forms are built and both are unit-tested. Every protect and unprotect writes a **new file**: an
encrypted document cannot be edited, so swapping one in for the document the reader has open would
take their work away.

**Attachments.** `src/pdf/attachments/` reads both places a PDF keeps embedded files — the
catalogue's name tree and file attachment annotations — and can now add, save out and remove them.
PaperForge still never opens one: saving writes the bytes where the reader chose, and a file whose
extension Windows would execute is named and confirmed first.

**Remove Hidden Information.** `src/pdf/sanitize/` scans for metadata, XMP, embedded files,
document JavaScript, launch and submit actions, hidden comments, form values, saved thumbnails,
hidden layers and alternate images, reports what it actually found, and removes only the categories
chosen. An action is read to follow its `/Next` chain and then deleted — never performed.

**Objects, not just references.** pdf-lib writes every indirect object it holds, whether or not
anything still points at it, so dropping a name-tree entry would hide an embedded file while its
bytes travelled on into the saved document. `src/pdf/sanitize/prune.ts` deletes the objects as
well, and a regression test asserts that the bytes of a removed attachment are nowhere in the file.
This matters more in Segment 15 than it does here.

**Where it shows up.** Document Properties, Protect PDF, Remove Hidden Information and Attach Files
are commands, command-palette entries and home-screen tool cards; the attachments panel gained its
own actions; the properties panel now reports security from the encryption dictionary rather than
the trailer scan, and links to the full dialog.

## Segment 15 — what landed

**Removal, not cover.** `src/pdf/redact/` cuts what lies under each mark out of the page's own
drawing. A glyph whose middle — or 30% of whose box — is under a mark is deleted from its show
operation and replaced by a `TJ` offset of the same advance, so the rest of the line stays exactly
where it was; this works for any font that says how wide its glyphs are, including composite
fonts PaperForge could never write new text in. `/ActualText` around cut text goes too. Pictures
wholly under a mark are removed; pictures partly under one are repainted in their own samples
(plain or deflated 8-bit grey/RGB/CMYK) and written as a new image. Paths wholly under a mark go.
Annotations under a mark go with their pop-ups; a widget takes its whole field. Thumbnails of
redacted pages are deleted.

**Refuse rather than half-do.** Anything the engine cannot cut safely — an unmeasurable font, a
partly covered form XObject or JPEG, an inline image, an undecodable stream — makes the page need a
picture. The window draws it upright without annotations, paints the marks onto the pixels and
stages it; the page is replaced with fresh resources. A page that needs a picture and was not given
one fails the whole edit. Every cut page is then read back, and the edit is refused if anything is
still under a mark.

**Nothing removed travels on.** Pictures and groups no longer drawn by any page are deleted even
when shared resources still list them, then every object unreachable from the trailer is deleted —
pdf-lib would otherwise write orphaned content streams (including the pre-edit page) into the file.

**In the workspace.** Redact (Tools menu, palette, home card) switches the other tools off and
shows the redaction toolbar and the list of marks. Marks come from a text selection, a dragged
area, or Find text to mark, which searches the same glyph model the cut uses, so a match marks
exactly the glyphs that will go. Apply Redactions reviews what each mark will remove and which pages
become pictures and why, optionally removes hidden information in the same step, applies one
undoable edit, and by default saves the result as "name redacted.pdf", leaving the opened file as
it was. Box colour and an optional reason label are chosen in the panel.

**Fixed on the way.** The PDF.js text layer never applied the CSS variables its spans are sized by,
so every span was smaller than its glyphs and selections covered the wrong characters
(`PdfPageView.module.css`, `pdfjsEngine.renderTextLayer`). The qpdf discovery tests now empty the
Program Files variables as well as PATH, since an installed qpdf made them fail; one admin e2e test
now waits for redo to land before saving.

| Area     | Files                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| Engine   | `src/pdf/redact/{geometry,text,graphics,pixels,annotations,page,plan,search,garbage,apply}.ts` |
| Shared   | `src/shared/schemas/redaction.ts`, the `applyRedactions` operation, `redact/failed`            |
| Main     | `main/ipc/handlers/redactionHandlers.ts`; `files:save` takes a name suffix                     |
| Renderer | `renderer/stores/redactionStore.ts`, `renderer/services/redactionRender.ts`, `redact/*`        |
| Tests    | `tests/unit/shared/redaction.test.ts` (the extraction gate), `tests/e2e/redact.e2e.ts`         |

**The gate.** 25 unit tests build documents with the marked phrase drawn in awkward ways — split
across runs, kerned arrays, the quote operators, a composite font, invisible OCR text, ActualText,
an earlier edit's leftover stream, inside a group, in an annotation, in a form field — apply the
redaction, and assert the phrase is neither returned by PDF.js text extraction nor present anywhere
in the saved file, with every stream decompressed and every string decoded. The end-to-end suite
does the same against the file the application saved.

## Segment 16 — what landed

**Compare Files.** A workspace of its own, like Create: choose the original and the revised
document from the open tabs (or open either from the toolbar), set a page offset when the revision
gained or lost pages at the front, and Compare. Each page pair is compared twice. The words PDF.js
gives are diffed with Myers' algorithm and grouped into additions, removals and changes
(`src/pdf/compare/textDiff.ts`). Both pages are drawn at one scale on paper of the larger size and
their pixels compared in a module worker (`src/workers/compare.worker.ts`), which gathers
differing pixels into regions; regions no text change explains are listed as picture or layout
changes, so a changed word is not reported twice. Unpaired pages and changed page sizes are
differences of their own. Results show side by side, with scrolling kept level, or overlaid in one
picture coloured by which document has the ink; the list filters by kind, and choosing an entry —
or Previous and Next — goes to its pair and outlines it on both pages. The comparison is a
cancellable job, keeps only rectangles per pair, and writes nothing anywhere.

**Optimize PDF.** Three presets (low compression, balanced, small file) and every setting behind
them. `src/pdf/optimize/` measures how large each picture is drawn, through groups, and brings
pictures drawn far above the target resolution down to it by area averaging; a picture drawn
where it cannot be measured (an annotation's appearance, a pattern) keeps its size rather than
being shrunk on a guess. JPEGs are decoded and re-encoded with Chromium's own codec through
`nativeImage`, so no image library was added; photographs stored losslessly can become JPEG while
drawings and screenshots — told apart by how many colours they use — stay lossless. Unfiltered
streams are deflated, thumbnails and unused objects removed, metadata on request, and qpdf packs
and linearises where it is installed. Only a result that came out smaller becomes the next
revision (`DocumentEditor.applyBytes`): one undoable step, measured before and after, written to
the file only by Save.

**Check and Repair.** `DocumentRepair` reports qpdf's `--check`, whether PaperForge's engine can
read the file, and PaperForge's own reading of the cross-reference table
(`src/pdf/structure/xrefCheck.ts`), which needs no sidecar — so damage is reported on a machine
without qpdf too. A repaired copy is written by qpdf where it is installed, and otherwise by the
engine's new `rewrite` (object-by-object parse, unreachable objects dropped); it is published like
every other file, opened in a new tab, and refused if it would replace the file that was opened. A
document the viewer cannot open offers the same dialog from its error screen.

**Crop Pages.** A tool of the viewer: drag a frame on a page, adjust it by its edges, corners or
the arrow keys, and apply the margins it leaves to that page, all pages or a range — as the crop
box, or as the page size itself with a warning. Typing a margin moves the frame. The panel shows
all five page boxes as the page declares them. The margin arithmetic moved to
`src/shared/utils/cropBoxes.ts`, which the page grid now shares.

**Fixed on the way.** The home screen still said documents could not be opened yet; it now says
how to start.

| Area     | Files                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine   | `src/pdf/compare/*`, `src/pdf/optimize/*`, `src/pdf/structure/xrefCheck.ts`, `rewrite` in the engine                                                   |
| Worker   | `src/workers/compare.worker.ts`                                                                                                                        |
| Main     | `main/services/documents/documentRepair.ts`, `main/services/optimize/*`, `repairHandlers.ts`                                                           |
| Shared   | `src/shared/schemas/{optimize,repair}.ts`, `src/shared/utils/cropBoxes.ts`                                                                             |
| Renderer | `stores/{compare,crop,optimize}Store.ts`, `services/compare{Render,Documents}.ts`, `components/{compare,crop,optimize,repair}/*`                       |
| Tests    | `tests/unit/shared/{compare,optimize,cropBoxes}.test.ts`, `tests/unit/main/document{Repair,Optimizer}.test.ts`, `tests/e2e/{compare,pageTools}.e2e.ts` |

## Segment 17 — what landed

**Accessibility Check.** A tool of its own in the properties panel (Tools menu, palette, home card).
It was the last home-screen card without a command, so the "not built yet" card state had nothing
left to describe and is gone. `src/pdf/accessibility/` reads the tag tree with its role map, the
marked-content brackets pages draw in, and what each page draws through its groups, and reports
fourteen checks: title, title bar, language, tags, figure alternate text, pages without text, field
descriptions, links that go nowhere, link descriptions, tab order, text outside the tags, security
against assistive technology, and two that only a person can make (reading order, contrast),
listed as such rather than passed. Statuses are words as well as colours. Fixes are edit operations
(title, title bar, language, alternate text, field descriptions, tab order), alternate text is
refused if the tag tree has moved, and the check runs again on each new revision. Pages without
text hand their numbers to Recognize Text, which opens with them as its range.

**Reading order.** `accessibility:readingOrder` boxes, for each element of the tag tree that owns
content on a page, the text, pictures, paths and groups drawn under its identifiers, numbered in
tree order; untagged text comes back separately and is drawn dashed. Only real structure and real
geometry are drawn.

**Bookmarks editing.** The bookmarks panel now reads the outline through the write engine and edits
it: add at the current view (a new `viewTop` in the view state records the height at the top of the
window), rename in place (F2, double-click), move up and down, nest and un-nest (Alt+Shift+arrows),
bold, italic, colour, re-point, delete, each undoable. The outline is read into arrays of its own
dictionaries, changed and relinked with correct `/Count`s, so an entry keeps whatever else it
carries. An encrypted document shows the PDF.js outline, read-only.

**Measuring.** Distance, perimeter and area, placed a click at a time (Shift keeps a segment level
or at 45 degrees), written as dimension annotations with a rectilinear `/Measure`, the value as the
comment and a caption in the appearance. Calibrate sets the document's scale from a known length; a
measurement keeps its scale, is re-measured when reshaped, and shows its value and scale in the
annotation properties and the Measure panel.

**Layers.** Nested display order with headings, Show all and Hide all, and Save as default, which
writes `/ON` and `/OFF` into the default optional-content configuration.

**Fixed on the way.** A Zustand selector that built a new scale object on every call made React
loop; the measuring components select the parts instead.

| Area     | Files                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Engine   | `src/pdf/accessibility/*`, `src/pdf/bookmarks/*`, `src/pdf/layers/defaults.ts`, `annotations/measure.ts`                   |
| Shared   | `schemas/{accessibility,bookmark}.ts`, `measure` on annotations, `utils/measure.ts`, eleven operations                     |
| Main     | `main/ipc/handlers/structureHandlers.ts`: `accessibility:check`, `accessibility:readingOrder`, `bookmarks:list`            |
| Renderer | `stores/{accessibility,bookmark,measure}Store.ts`, `components/{accessibility,measure}/*`, `BookmarkEditor`, `LayersPanel` |
| Tests    | `unit/shared/{accessibility,bookmarks,measure,layers}.test.ts`, `e2e/{accessibility,bookmarks,measure}.e2e.ts`             |

## What is not yet verified

**Segment 17 against third-party files and assistive technology.** The checks, alternate text and
reading order are proven on generated tagged documents. Walk the Segment 17 section of
`docs/QA_CHECKLIST.md` with a tagged Word export and a screen reader, and check measurements on a
real scaled drawing.

**Protect PDF against a real qpdf.** qpdf 12.4.2 is now installed on the build machine, and every
save in the end-to-end suite was checked by it, but the Protect walkthrough in
`docs/QA_CHECKLIST.md` (encrypt, reopen with the wrong and the right password, remove security) has
still not been run by hand. It needs no new code.

**Compare and Optimize on third-party files.** Both are proven on generated documents, and
Optimize's JPEG path ran against Chromium's real codec in the end-to-end suite. Walk the Segment 16
section of `docs/QA_CHECKLIST.md` on a few real documents — two exported versions of one report, a
photograph-heavy brochure, a scanned file — before relying on the sizes and the difference lists.

**Redaction on third-party files.** The redaction gate is proven on generated documents covering
the shapes listed above. Walk the Segment 15 section of `docs/QA_CHECKLIST.md` on a few real
documents (a Word export, a scanned and recognised file, a form) before relying on it.

## Required local tools

- qpdf: optional. Saved files are checked with it when it is installed; Settings → Local tools
  reports what was found and can point at a different one. Protect PDF needs it; Check and Repair
  and Optimize PDF use it when it is there (a stronger repair; packing and fast web view) and work
  without it.
- Tesseract: optional, and needed for Recognize Text. PaperForge looks in the usual Windows
  locations and on the PATH; Settings → Text recognition says what was found and can point at
  another copy or another tessdata folder. Nothing is downloaded.
- LibreOffice: optional, and needed only for Office documents. PaperForge looks in the usual
  Windows locations and on the PATH; Settings → Local tools says what was found and can point at
  another copy. Nothing is downloaded.

Nothing is downloaded at runtime, then or now.

## Last validation

Run on Windows 11 x64, Node 24.19.0, npm 11.17.0:

| Command                     | Result                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm install`               | Pass; unchanged this segment, no dependency added                                                         |
| `npm run typecheck`         | Pass; four projects, no errors                                                                            |
| `npm run lint`              | Pass; no errors, no warnings                                                                              |
| `npm test`                  | Pass; 807 tests in 72 files                                                                               |
| `npm run test:e2e`          | Pass; 165 Playwright tests against the built application                                                  |
| `npm run format:check`      | Pass; Prettier clean                                                                                      |
| `npm run dev`               | Pass; Vite dev server and Electron window, no renderer errors in the log                                  |
| `npm run package`           | Pass; `out/PaperForge-win32-x64/PaperForge.exe`                                                           |
| Packaged launch/close smoke | Pass; window ready in about 1 s                                                                           |
| Appearance                  | Checked in the real application: the check and reading order in light and dark, bookmark tools, measuring |

## Manual setup required

None beyond `npm install`. On npm 11 the first install asks to approve the Electron install script;
`package.json` already records the approval (`allowScripts`), so it should not ask again.

## Where Segment 18 starts

- **Printing** has nothing yet: there is no `Ctrl+P` command (it is listed as planned in
  `docs/KEYBOARD_SHORTCUTS.md`). Rendering pages for a print document can reuse the rendering the
  export and redaction paths use (`renderer/services/exportRender.ts`), and leaving annotations out
  can use the `contentOnly` render option.
- **File association and Open With** need the packaging config (`forge.config.ts`, zip only today)
  and the main process's `second-instance` handler, which today only focuses the window, to open
  the paths it is given.
- **Taskbar progress** can follow the job store (`renderer/stores/jobStore.ts`).

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
