# PaperForge Progress

## Current status

- Last completed segment: **4 — Navigation panels and search**
- Next segment: **5 — Mutation engine, save pipeline, undo/redo**
- Build status: `npm run package` succeeds; packaged app launches and closes cleanly on Windows 11 x64
- Test status: 259 unit tests (28 files) and 23 Playwright end-to-end tests passing; typecheck, lint and format clean

## Completed segments

- [x] 0 Repository foundation
- [x] 1 Fluent Workspace shell and command system
- [x] 2 File service, tabs, recovery architecture
- [x] 3 PDF.js viewer foundation
- [x] 4 Navigation panels and search
- [ ] 5 Mutation engine, save pipeline, undo/redo
- [ ] 6 Comments and annotations
- [ ] 7 Organize Pages
- [ ] 8 Create PDF and Combine Files
- [ ] 9 Edit PDF: content model and text editing
- [ ] 10 Edit PDF: images, links, layout content
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
- `dirty` is always false because nothing can modify a document yet. The close-warning path, the
  tab marker and the journal flag are implemented and unit-tested, and become reachable in
  Segment 5.
- Fourteen of the fifteen home-screen tool cards are disabled because their capability is not built.
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

- qpdf: not required yet — integrated in Segment 5/14
- Tesseract: not required yet — integrated in Segment 12
- LibreOffice: not required yet — optional, integrated in Segment 13

Nothing is downloaded at runtime, then or now.

## Last validation

Run on Windows 11 x64, Node 24.19.0, npm 11.17.0:

| Command                     | Result                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm install`               | Pass (npm 11 asks once to approve the Electron install script)                                                        |
| `npm run typecheck`         | Pass — four projects, no errors                                                                                       |
| `npm run lint`              | Pass — no errors, no warnings                                                                                         |
| `npm test`                  | Pass — 259 tests in 28 files                                                                                          |
| `npm run test:e2e`          | Pass — 23 Playwright tests against the built application                                                              |
| `npm run format:check`      | Pass — Prettier clean                                                                                                 |
| `npm run dev`               | Pass — Vite dev server and Electron window; no renderer errors in the log                                             |
| `npm run package`           | Pass — `out/PaperForge-win32-x64/PaperForge.exe`                                                                      |
| Packaged launch/close smoke | Pass — window ready in ~400 ms, closes cleanly, and `%TEMP%/PaperForge/sessions` is empty afterwards                  |
| Settings upgrade            | Pass — a settings file without the new `session` section is repaired in place                                         |
| Appearance                  | Checked in light and dark by screenshotting the real application: find bar with results, each panel, and reading mode |

## Manual setup required

None beyond `npm install`. On npm 11 the first install asks to approve the Electron install script;
`package.json` already records the approval (`allowScripts`), so it should not ask again.

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
