# PaperForge Progress

## Current status

- Last completed segment: **1 — Fluent Workspace shell and command system**
- Next segment: **2 — File service, tabs, recovery architecture**
- Build status: `npm run package` succeeds; packaged app launches and closes cleanly on Windows 11 x64
- Test status: 105 unit tests passing (15 files); typecheck and lint clean

## Completed segments

- [x] 0 Repository foundation
- [x] 1 Fluent Workspace shell and command system
- [ ] 2 File service, tabs, recovery architecture
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

**Working features:** window with saved and validated geometry, light/dark/system theme resolved by
the main process and persisted, environment diagnostics with copy-to-clipboard, status bar, error
boundaries, local rotating log with secret redaction, atomic settings persistence with recovery from
a corrupt file.

| Area            | Files                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build           | `forge.config.ts`, `vite.{main,preload,renderer}.config.mts`, `vitest.config.mts`, `tsconfig*.json`, `eslint.config.mjs`         |
| Main process    | `src/main/index.ts`, `windows/`, `security/`, `ipc/`, `theme/`, `services/`                                                      |
| Preload         | `src/preload/{index,api}.ts`                                                                                                     |
| Shared contract | `src/shared/ipc/*`, `src/shared/schemas/*`, `src/shared/errors/appError.ts`, `src/shared/types/bridge.ts`                        |
| Assets          | `scripts/generate-icon.mjs` produces `resources/icons/icon.{ico,png}`                                                            |
| Docs            | `README.md`, `docs/{ARCHITECTURE,SECURITY,DEPENDENCIES,KEYBOARD_SHORTCUTS,QA_CHECKLIST}.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE` |

## Segment 1 — what landed

**Command system.** A single registry (`src/renderer/commands`) backs the menu bar, left rail,
command palette, keyboard shortcuts and shell buttons. Commands declare their own availability and
checked state; the registry rejects duplicate ids and duplicate chords and refuses to execute an
unknown or disabled command. Nineteen commands are registered — every one of them works.

**Shell.** Title bar, registry-driven menu bar with a command search field, left rail, resizable and
persisted left and right panels, workspace region and status bar. All six regions are `F6` targets.

**Home screen.** Intro, recent and pinned files from the local store, and the tool catalogue from
`CLAUDE.md` section 6.2.

**Overlays.** Modal dialog with focus trap and focus restore (Settings, About), `Ctrl+K` command
palette, toast host, and the progress centre backed by a real job store.

**Main process.** Recent-files store with retention and pin handling, window runtime state
(`window:getState`, `window:toggleFullScreen`, `window:stateChanged`) so `F11` uses the real window,
and a shared BOM-tolerant JSON reader used by both stores.

| Area         | Key files                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Commands     | `commands/{registry,definitions,types,CommandProvider,commandApiContext,useCommands,filterCommands}` |
| Keyboard     | `keyboard/{shortcuts,focusRegions}.ts`                                                               |
| Shell        | `components/shell/{AppShell,TitleBar,CommandBar,LeftRail,PanelResizer,StatusBar}`                    |
| Panels       | `components/panels/{LeftPanel,RightPanel,EmptyPanelState}`                                           |
| Home         | `components/home/{HomeScreen,ToolCard,toolCatalog,RecentFilesList}`                                  |
| Overlays     | `components/overlays/{Dialog,SettingsDialog,AboutDialog,CommandPalette,ToastHost}`                   |
| Progress     | `components/progress/ProgressCenter`, `stores/jobStore.ts`                                           |
| Main process | `services/recentFiles/recentFilesStore.ts`, `services/filesystem/readJsonFile.ts`                    |
| Shared       | `schemas/{settings,recentFiles,windowState}.ts`                                                      |

## Architecture decisions

1. **Channel allowlist separate from schemas.** `shared/ipc/channelNames.ts` imports nothing, so the
   preload bundle stays tiny and carries no validation library; `contracts.ts` holds the Zod schemas
   and is `satisfies Record<InvokeChannel, …>`, so the two cannot drift. A unit test asserts it too.
2. **IPC never rejects.** Handlers resolve an `IpcResult` envelope; the renderer's client rethrows a
   typed `AppError`. Requests, responses and pushed events are each schema-validated.
3. **`app://` scheme instead of `file://` for the packaged renderer.** Gives a real origin, lets the
   protocol handler attach the CSP itself (webRequest does not see custom schemes), and confines
   every request to the renderer output directory with traversal protection.
4. **Main process owns theme resolution.** `nativeTheme` is the single source of truth and pushes
   `theme:changed`, so "Follow system" stays correct when Windows changes at runtime.
5. **CommonJS main and preload.** Sandboxed preload scripts cannot be ES modules; making the package
   ESM would force a mixed-format build for no benefit. Vite configs use `.mts` so they can still use
   `import.meta`.
6. **Four TypeScript projects** (tooling, main/preload/shared, renderer/shared, tests) with different
   libs and globals, plus ESLint rules that forbid `electron`, `fs` and `path` imports in the
   renderer.
7. **Deny-by-default packaging.** `forge.config.ts` ships only `.vite/**`, `package.json`, `LICENSE`
   and `THIRD_PARTY_NOTICES.md`.
8. **Electron fuses on**: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no CLI inspect arguments,
   cookie encryption, embedded asar integrity validation, load-only-from-asar.
9. **Hand-written icon generator.** `scripts/generate-icon.mjs` renders original geometry into a
   multi-size `.ico` with no image tooling and no network, matching the in-app `LogoMark`.
10. **TypeScript pinned to 6.0.3, not 7.x**, because `typescript-eslint@8` peer-requires `<6.1.0` and
    type-aware lint rules are worth more than the newest compiler.
11. **Fluent UI React Components still not installed.** The shell's controls are small and specific
    (menu bar, rail, resizer, palette); adding a control library now would mean theming two systems.
    The tokens stay framework-neutral, so the decision remains open.
12. **Squirrel maker deferred to Segment 18**, where the installer is actually specified.
13. **Only working commands are registered.** A capability that does not exist has no command, so it
    cannot appear in a menu or the palette. That is why the bar shows View, Tools and Help and no
    others yet — File and Edit arrive with the commands that fill them.
14. **The tool catalogue is the one place planned tools are visible.** The home screen shows all
    fifteen tools from the specification; a card is interactive only when its command exists, and
    every other card is a disabled button marked "Not yet available" that does nothing when clicked.
    This was a deliberate trade-off against `CLAUDE.md` 0.2: the segment explicitly asks for tool
    cards, and a visibly disabled control is honest where a silent no-op would not be. The tools
    panel takes the opposite approach and lists only usable tools, so the working surface carries no
    dead entries.
15. **Panel geometry lives in settings, not component state.** Dragging a divider uses local state
    for the duration of the gesture only; the width is written once, on release.
16. **The main process owns full screen.** `F11` calls `BrowserWindow.setFullScreen` over IPC rather
    than the HTML fullscreen API, and the window pushes its state back, so the renderer and the
    window cannot disagree.
17. **Recent files have a real store now, with a deliberately narrow IPC surface.** The store
    supports add, pin, remove and clear and is unit-tested; only list and clear are exposed over IPC
    because nothing can open a file yet. Segment 2 adds the rest together with the UI that uses it.
18. **Commands live in the renderer**, not `src/shared/commands` as sketched in `CLAUDE.md`
    section 4, because every implementation is renderer-side. If a native Windows menu ever needs the
    ids, the id list moves to `shared` then.

## Known limitations

- No PDF capability yet of any kind — that begins in Segment 3. The home screen says so plainly.
- No document can be opened, so document tabs, the tab strip in the title bar and every
  document-dependent panel show empty states. Those arrive in Segments 2 and 3.
- Fourteen of the fifteen home-screen tool cards are disabled because their capability is not built;
  see decision 14.
- Tooltips use the native `title` attribute. A styled tooltip component can come later; the
  accessible name and the hover text are correct today.
- The left panel has no keyboard shortcut yet — `docs/KEYBOARD_SHORTCUTS.md` explains why.
- No end-to-end tests yet; Playwright arrives with the first real user flow (Segment 2).
- `resources/bundled-tools` and `resources/tessdata` exist but are empty and git-ignored. qpdf,
  Tesseract and LibreOffice are not integrated.
- The Windows installer, file associations and "Open with" are not built (Segment 18); `npm run make`
  produces a zip.
- Prettier reformatted `CLAUDE.md` once during Segment 0 (markdown whitespace only, no content
  change) before it was added to `.prettierignore`; it will not be touched again.

## Required local tools

- qpdf: not required yet — integrated in Segment 5/14
- Tesseract: not required yet — integrated in Segment 12
- LibreOffice: not required yet — optional, integrated in Segment 13

Nothing is downloaded at runtime, then or now.

## Last validation

Run on Windows 11 x64, Node 24.19.0, npm 11.17.0:

| Command                     | Result                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm install`               | Pass (npm 11 asks once to approve the Electron install script)                                                  |
| `npm run typecheck`         | Pass — four projects, no errors                                                                                 |
| `npm run lint`              | Pass — no errors, no warnings                                                                                   |
| `npm test`                  | Pass — 105 tests in 15 files                                                                                    |
| `npm run dev`               | Pass — Vite dev server and Electron window; no renderer errors in the log                                       |
| `npm run package`           | Pass — `out/PaperForge-win32-x64/PaperForge.exe`, asar 2.3 MB                                                   |
| Packaged launch/close smoke | Pass — window ready in ~700 ms, closes cleanly, writes valid `settings.json` including the new layout section   |
| Settings upgrade            | Pass — a Segment 0 `settings.json` with no `layout` section is repaired in place, keeping the values it had     |
| Corrupt-settings recovery   | Pass — invalid `settings.json` logs a warning, the app starts on defaults and rewrites a valid file             |
| Shell appearance            | Checked in light and dark by capturing the running renderer: panels, menus, empty states and tool cards correct |

## Manual setup required

None beyond `npm install`. On npm 11 the first install asks to approve the Electron install script;
`package.json` already records the approval (`allowScripts`), so it should not ask again.

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
