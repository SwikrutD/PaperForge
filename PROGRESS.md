# PaperForge Progress

## Current status

- Last completed segment: **0 — Repository foundation**
- Next segment: **1 — Fluent Workspace shell and command system**
- Build status: `npm run package` succeeds; packaged app launches and closes cleanly on Windows 11 x64
- Test status: 41 unit tests passing (10 files); typecheck and lint clean

## Completed segments

- [x] 0 Repository foundation
- [ ] 1 Fluent Workspace shell and command system
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

**Key files**

| Area            | Files                                                                                                                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build           | `forge.config.ts`, `vite.{main,preload,renderer}.config.mts`, `vitest.config.mts`, `tsconfig*.json`, `eslint.config.mjs`                                                                                                                                                                             |
| Main process    | `src/main/index.ts`, `windows/mainWindow.ts`, `windows/rendererProtocol.ts`, `security/csp.ts`, `security/hardening.ts`, `ipc/registry.ts`, `ipc/registerHandlers.ts`, `theme/themeController.ts`, `services/{appInfo,logging/logger,settings/settingsStore,filesystem/{atomicWrite,pathSafety}}.ts` |
| Preload         | `src/preload/{index,api}.ts`                                                                                                                                                                                                                                                                         |
| Shared contract | `src/shared/ipc/{channelNames,contracts,result}.ts`, `schemas/{settings,appInfo,theme}.ts`, `errors/appError.ts`, `types/bridge.ts`                                                                                                                                                                  |
| Renderer        | `src/renderer/main.tsx`, `app/{App,AppErrorBoundary}.tsx`, `design-system/{tokens,base}.css`, `components/**`, `services/ipcClient.ts`, `stores/appStore.ts`                                                                                                                                         |
| Assets          | `scripts/generate-icon.mjs` → `resources/icons/icon.{ico,png}`                                                                                                                                                                                                                                       |
| Docs            | `README.md`, `docs/{ARCHITECTURE,SECURITY,DEPENDENCIES,KEYBOARD_SHORTCUTS,QA_CHECKLIST}.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE`                                                                                                                                                                     |

**Working features** (all real, no placeholders): window with saved and validated geometry,
light/dark/system theme resolved by the main process and persisted, environment diagnostics with
copy-to-clipboard, status bar, error boundaries, local rotating log with secret redaction, atomic
settings persistence with recovery from a corrupt file.

## Architecture decisions

1. **Channel allowlist separate from schemas.** `shared/ipc/channelNames.ts` imports nothing, so
   the preload bundle is 610 bytes and carries no validation library; `contracts.ts` holds the Zod
   schemas and is `satisfies Record<InvokeChannel, …>`, so the two cannot drift. A unit test asserts
   it as well.
2. **IPC never rejects.** Handlers resolve an `IpcResult` envelope; the renderer's client rethrows a
   typed `AppError`. Requests, responses and pushed events are each schema-validated.
3. **`app://` scheme instead of `file://` for the packaged renderer.** Gives a real origin, lets the
   protocol handler attach the CSP itself (webRequest does not see custom schemes), and confines
   every request to the renderer output directory with traversal protection.
4. **Main process owns theme resolution.** `nativeTheme` is the single source of truth and pushes
   `theme:changed`, so "Follow system" stays correct when Windows changes at runtime.
5. **CommonJS main and preload.** Sandboxed preload scripts cannot be ES modules; making the package
   ESM would force a mixed-format build for no benefit. Vite configs use `.mts` so they can still
   use `import.meta`.
6. **Four TypeScript projects** (tooling, main/preload/shared, renderer/shared, tests) with
   different libs and globals, plus ESLint rules that forbid `electron`, `fs` and `path` imports in
   the renderer.
7. **Deny-by-default packaging.** `forge.config.ts` ships only `.vite/**`, `package.json`, `LICENSE`
   and `THIRD_PARTY_NOTICES.md`; the asar is 2.0 MB and contains nothing else.
8. **Electron fuses on**: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no CLI inspect arguments,
   cookie encryption, embedded asar integrity validation, load-only-from-asar.
9. **Hand-written icon generator.** `scripts/generate-icon.mjs` renders original geometry (a sheet
   with a folded corner on a blue tile) into a multi-size `.ico` with no image tooling and no
   network, matching the in-app `LogoMark`.
10. **TypeScript pinned to 6.0.3, not 7.x**, because `typescript-eslint@8` peer-requires `<6.1.0`
    and type-aware lint rules are worth more than the newest compiler.
11. **Fluent UI React Components deferred to Segment 1.** Segment 0 needed tokens, not a control
    library; the design tokens are framework-neutral so either choice remains open.
12. **Squirrel maker deferred to Segment 18**, where the installer is actually specified, rather
    than carrying `electron-winstaller` and its dependency tree unused.

## Known limitations

- No PDF capability yet of any kind — that begins in Segment 3. The window shows the application
  foundation and says so plainly.
- The shell is header + content + status bar only. Left rail, side panels, tabs, command bar,
  command palette and Home screen are Segment 1.
- No end-to-end tests yet; Playwright arrives with the first real user flow (Segment 2).
- `resources/bundled-tools` and `resources/tessdata` exist but are empty and git-ignored. qpdf,
  Tesseract and LibreOffice are not integrated.
- The Windows installer, file associations and "Open with" are not built (Segment 18); `npm run make`
  produces a zip.
- Prettier reformatted `CLAUDE.md` once (markdown whitespace only, no content change) before it was
  added to `.prettierignore`; it will not be touched again.

## Required local tools

- qpdf: not required yet — integrated in Segment 5/14
- Tesseract: not required yet — integrated in Segment 12
- LibreOffice: not required yet — optional, integrated in Segment 13

Nothing is downloaded at runtime, then or now.

## Last validation

Run on Windows 11 x64, Node 24.19.0, npm 11.17.0:

| Command                     | Result                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm install`               | Pass (npm 11 requires approving Electron's install script once)                                    |
| `npm run typecheck`         | Pass — four projects, no errors                                                                    |
| `npm run lint`              | Pass — no errors, no warnings                                                                      |
| `npm test`                  | Pass — 41 tests in 10 files                                                                        |
| `npm run dev`               | Pass — Vite dev server and Electron window; log shows "Main window ready." with no renderer errors |
| `npm run package`           | Pass — `out/PaperForge-win32-x64/PaperForge.exe`, asar 2.0 MB                                      |
| Packaged launch/close smoke | Pass — starts packaged, window ready in ~850 ms, closes cleanly, writes valid `settings.json`      |
| Corrupt-settings recovery   | Pass — invalid `settings.json` logs a warning, app starts on defaults and rewrites a valid file    |

## Manual setup required

None beyond `npm install`. On npm 11 the first install asks to approve Electron's install script;
`package.json` already records the approval (`allowScripts`), so it should not ask again.

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
