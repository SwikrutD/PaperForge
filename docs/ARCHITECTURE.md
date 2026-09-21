# Architecture

PaperForge is an Electron desktop application with three isolated execution contexts and a shared,
schema-validated contract between them.

```
┌────────────────────────── main process (Node) ───────────────────────────┐
│ app lifecycle · window management · settings · logging · theme           │
│ security policy (CSP, protocol, navigation) · IPC handlers               │
│ later: qpdf / Tesseract / LibreOffice sidecars, filesystem, jobs         │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ typed IPC, validated both ways
┌───────────────┴─── preload (isolated world, sandboxed, CommonJS) ────────┐
│ contextBridge → window.paperforge: allowlisted invoke + subscribe only   │
└───────────────▲──────────────────────────────────────────────────────────┘
                │
┌───────────────┴─────────────── renderer (Chromium) ──────────────────────┐
│ React + TypeScript · Zustand stores · Fluent Workspace design tokens     │
│ later: PDF.js viewer, editing surfaces, panels, command system           │
└──────────────────────────────────────────────────────────────────────────┘
```

## Directory layout

```
src/
  main/            Electron main process
    windows/       window creation, app:// renderer protocol
    security/      CSP construction, web contents and session hardening
    ipc/           validated IPC registrar and handler registration
    theme/         nativeTheme ownership and broadcast
    services/      settings, logging, filesystem helpers, app info
  preload/         contextBridge surface (no dependencies, no Node APIs re-exported)
  renderer/
    app/           App root and error boundaries
    components/    brand, controls, shell, surfaces, diagnostics, workspace
    design-system/ tokens.css and base.css
    services/      typed IPC client
    stores/        Zustand state
    utils/         small renderer helpers
  shared/          used by all three contexts
    constants/     names, scheme, file names
    errors/        AppError and its serializable form
    ipc/           channel allowlist, Zod contracts, result envelope
    schemas/       settings, app info, theme
    types/         the preload bridge interface
scripts/           build-time tooling (icon generation)
tests/unit/        Vitest suites mirroring src/
resources/         icons and, later, staged local sidecars and tessdata
```

Folders named in `CLAUDE.md` section 4 that have no code yet (`src/pdf`, `src/conversion`,
`src/workers`, panels, tools) are created by the segment that introduces them, so the tree never
carries empty scaffolding.

## Cross-process contract

`src/shared/ipc` is the single source of truth:

- `channelNames.ts` — the allowlist. It imports nothing, which keeps the preload bundle to a few
  hundred bytes and free of Zod.
- `contracts.ts` — a Zod request and response schema per invoke channel, plus a schema per pushed
  event. It is `satisfies Record<InvokeChannel, …>`, so a channel cannot exist in the allowlist
  without a schema or vice versa. A unit test asserts the two stay in sync.
- `result.ts` — the `IpcResult` envelope. Handlers never reject; they resolve with
  `{ ok: true, data }` or `{ ok: false, error }`, so errors cross the boundary as typed data.

Validation happens on both sides of every hop:

| Direction             | Validated by                     | Against                       |
| --------------------- | -------------------------------- | ----------------------------- |
| renderer → main       | `main/ipc/registry.ts`           | the channel's request schema  |
| main → renderer       | `main/ipc/registry.ts`           | the channel's response schema |
| main event → renderer | `renderer/services/ipcClient.ts` | the event schema              |

Adding a channel means: add the name, add the schemas, register a handler, call it through
`renderer/services/ipcClient.ts`. No component ever touches `ipcRenderer`.

## Error model

`shared/errors/appError.ts` defines a closed set of error codes covering the categories in
`CLAUDE.md` section 37 (invalid PDF, wrong password, sidecar missing, write failure, cancelled, and
so on). Each code carries a default plain-language message; diagnostics go in an optional `details`
field that the UI shows only behind a "Details" expander. `AppError.serialize()` turns any
throwable into that shape without leaking a stack trace to the user.

## Settings and theme

Settings live in `%APPDATA%/PaperForge/settings.json`, parsed with Zod on read. An unreadable or
partially invalid file is repaired to defaults rather than failing startup. Writes go through
`writeFileAtomic` (temp file → fsync → rename), which is the same primitive the document save
pipeline will build on in Segment 5.

The main process owns theme resolution: it sets `nativeTheme.themeSource` from the stored
preference and pushes the resolved light/dark value to the renderer. The renderer never guesses
from a media query, so "Follow system" stays correct when Windows changes at runtime.

## Renderer serving

- Development: the Vite dev server on `http://localhost:<port>`, with CSP applied through
  `webRequest.onHeadersReceived`.
- Production: a custom `app://renderer/` scheme registered as standard and secure. The handler
  resolves every request inside the renderer output directory (traversal, absolute paths and drive
  qualifiers are rejected) and attaches the CSP and `X-Content-Type-Options` headers itself,
  because `webRequest` does not observe custom schemes and `file://` has no usable origin.

## Build

Electron Forge drives Vite: `src/main/index.ts` → `.vite/build/main.js` (CommonJS),
`src/preload/index.ts` → `.vite/build/preload.js` (CommonJS, required because sandboxed preload
scripts cannot be ES modules), and the renderer → `.vite/renderer/main_window/`. Packaging uses an
allowlist, so only build output, `package.json` and the legal notices reach the asar. Electron
fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and CLI inspect arguments, enable cookie
encryption and asar integrity validation, and require the app to load from the asar.

TypeScript is split into four strict projects — tooling, main/preload/shared, renderer/shared and
tests — because they have genuinely different globals (Node vs DOM) and must not borrow each
other's APIs by accident. ESLint enforces the same separation: the renderer may not import
`electron`, `fs` or `path`.
