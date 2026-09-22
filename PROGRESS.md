# PaperForge Progress

## Current status

- Last completed segment: **2 — File service, tabs, recovery architecture**
- Next segment: **3 — PDF.js viewer foundation**
- Build status: `npm run package` succeeds; packaged app launches and closes cleanly on Windows 11 x64
- Test status: 149 unit tests (19 files) and 5 Playwright end-to-end tests passing; typecheck and lint clean

## Completed segments

- [x] 0 Repository foundation
- [x] 1 Fluent Workspace shell and command system
- [x] 2 File service, tabs, recovery architecture
- [ ] 3 PDF.js viewer foundation
- [ ] 4 Navigation panels and search
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
23. **End-to-end tests drive the unpackaged build.** The inspector fuse that protects the packaged
    application also blocks a test runner, so Playwright launches the same bundle with the Electron
    binary and the packaged build is smoke-tested separately.

## Known limitations

- No page rendering yet: an open document shows its file facts, not its pages. The viewer is
  Segment 3, and the document view says so.
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

| Command                     | Result                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm install`               | Pass (npm 11 asks once to approve the Electron install script)                                          |
| `npm run typecheck`         | Pass — four projects, no errors                                                                         |
| `npm run lint`              | Pass — no errors, no warnings                                                                           |
| `npm test`                  | Pass — 149 tests in 19 files                                                                            |
| `npm run test:e2e`          | Pass — 5 Playwright tests against the built application                                                 |
| `npm run dev`               | Pass — Vite dev server and Electron window; no renderer errors in the log                               |
| `npm run package`           | Pass — `out/PaperForge-win32-x64/PaperForge.exe`                                                        |
| Packaged launch/close smoke | Pass — window ready in ~400 ms, closes cleanly, and `%TEMP%/PaperForge/sessions` is empty afterwards    |
| Settings upgrade            | Pass — a settings file without the new `session` section is repaired in place                           |
| Appearance                  | Checked in light and dark by capturing the running renderer: tabs, document view and status bar correct |

## Manual setup required

None beyond `npm install`. On npm 11 the first install asks to approve the Electron install script;
`package.json` already records the approval (`allowScripts`), so it should not ask again.

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
