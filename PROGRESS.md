# PaperForge Progress

## Current status

- Last completed segment: **10 — Edit PDF: images, links, layout content**
- Next segment: **11 — Forms and Fill & Sign**
- Build status: `npm run package` succeeds; packaged app launches and closes cleanly on Windows 11 x64
- Test status: 565 unit tests (49 files) and 95 Playwright end-to-end tests passing; typecheck, lint and format clean

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
- [ ] 11 Forms and Fill & Sign
- [ ] 12 OCR
- [ ] 13 Conversion center
- [ ] 14 Protect, metadata, sanitize, attachments
- [ ] 15 True redaction
- [ ] 16 Compare, optimize, repair, crop
- [ ] 17 Accessibility and practical advanced tools
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

## Known limitations

- The viewer is continuous scrolling only. Single page, two-page spread, cover page, the hand and
  marquee-zoom tools and presentation mode are part of the fuller viewer in `CLAUDE.md` section 10
  and are not built yet.
- Layer visibility applies to the view only. Saving a default layer state needs the write engine,
  which is Segment 5.
- Attachments are listed but cannot be saved, added or removed; that is Segment 14. No size is
  shown, because the listing PDF.js returns does not carry one.
- Bookmarks can be read and followed but not added, renamed, reordered or restyled (Segment 17).
- Search covers text. Searching bookmarks and annotations, and regular expressions, are not
  implemented; a query is matched literally, so punctuation searches for itself.
- A search stops collecting at 5,000 matches and says so rather than growing without bound.
- Search highlights are placed from text-run geometry, so on a run with unusual per-glyph spacing a
  highlight can be a fraction of a character out. It never affects what is found, only what is
  drawn.
- Form fields are drawn from their appearance streams but are not interactive; that is Segment 11.
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
  Tesseract and LibreOffice are not integrated.
- The Windows installer, file associations and "Open with" are not built (Segment 18); `npm run make`
  produces a zip.
- Prettier reformatted `CLAUDE.md` once during Segment 0 (whitespace only) before it was added to
  `.prettierignore`.

## Required local tools

- qpdf: optional. Saved files are checked with it when it is installed; Settings → Local tools
  reports what was found and can point at a different one. Encryption and repair follow in
  Segment 14.
- Tesseract: not required yet — integrated in Segment 12
- LibreOffice: not required yet — optional, integrated in Segment 13

Nothing is downloaded at runtime, then or now.

## Last validation

Run on Windows 11 x64, Node 24.19.0, npm 11.17.0:

| Command                     | Result                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`               | Pass (npm 11 asks once to approve the Electron install script)                                                                              |
| `npm run typecheck`         | Pass — four projects, no errors                                                                                                             |
| `npm run lint`              | Pass — no errors, no warnings                                                                                                               |
| `npm test`                  | Pass — 565 tests in 49 files                                                                                                                |
| `npm run test:e2e`          | Pass — 95 Playwright tests against the built application                                                                                    |
| `npm run format:check`      | Pass — Prettier clean                                                                                                                       |
| `npm run dev`               | Pass — Vite dev server and Electron window; no renderer errors in the log                                                                   |
| `npm run package`           | Pass — `out/PaperForge-win32-x64/PaperForge.exe`                                                                                            |
| Packaged launch/close smoke | Pass — window ready in ~400 ms, closes cleanly, and `%TEMP%/PaperForge/sessions` is empty afterwards                                        |
| Settings upgrade            | Pass — a settings file without the new `session` section is repaired in place                                                               |
| Appearance                  | Checked by driving the real application: the image editor's handles and panel, and the watermark and header dialogs with Bates numbering on |

## Manual setup required

None beyond `npm install`. On npm 11 the first install asks to approve the Electron install script;
`package.json` already records the approval (`allowScripts`), so it should not ask again.

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
