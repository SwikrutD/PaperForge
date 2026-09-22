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
    windows/       window creation, app:// renderer protocol, window state events
    security/      CSP construction, web contents and session hardening
    ipc/           validated IPC registrar and handler registration
    theme/         nativeTheme ownership and broadcast
    services/      settings, recent files, logging, filesystem helpers, app info
  preload/         contextBridge surface (no dependencies, no Node APIs re-exported)
  renderer/
    app/           App root and error boundaries
    commands/      command registry, definitions, React provider, palette filter
    keyboard/      shortcut parsing and dispatch, F6 focus regions
    components/
      brand/       the PaperForge mark
      controls/    button, icon button, menu bar, theme switcher
      home/        home screen, tool catalogue, recent files
      overlays/    dialog shell, settings, about, command palette, toasts
      panels/      left panel, right panel, shared empty state
      progress/    progress centre
      shell/       title bar, command bar, rail, resizer, status bar, frame
      surfaces/    card, message bar
    design-system/ tokens.css and base.css
    services/      typed IPC client
    stores/        Zustand state (app, ui, jobs)
    types/         UI and job models
    utils/         small renderer helpers
  shared/          used by all three contexts
    constants/     names, scheme, file names
    errors/        AppError and its serializable form
    ipc/           channel allowlist, Zod contracts, result envelope
    schemas/       settings, app info, theme, window state, recent files
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

## Command system

Every action a user can take is a command. `src/renderer/commands/definitions.ts` is the complete
list; `registry.ts` holds them and answers three questions about each one: does it exist, can it run
right now, and is it currently on.

```
CommandDefinition { id, title, category, group, icon, shortcut, keywords,
                    isAvailable(context), isChecked(context), run(context) }
```

- The **menu bar**, **left rail**, **command palette**, **keyboard dispatcher** and shell buttons all
  resolve through the registry, so a command has exactly one implementation and one enablement rule.
- `CommandContext` carries the current settings, theme, environment, recent files and window state
  plus a narrow `CommandActions` seam (patch settings, toggle full screen, open a dialog, show a
  toast, …). Components never reach into stores to perform an action a command already owns.
- The registry refuses duplicate ids and duplicate chords at construction, and refuses to execute an
  unknown or disabled command — a dead control cannot be shipped by accident.
- **Only commands that work are registered.** A capability that does not exist yet has no command,
  so it cannot appear in a menu or the palette. The home screen's tool catalogue is the one place
  that shows planned tools, and those cards are genuinely disabled.

Shortcuts are declared on the command as a Windows-style chord and parsed once
(`keyboard/shortcuts.ts`). One global `keydown` listener resolves a chord to a command id. Bare-key
chords are ignored while the user is typing in a field.

F6 cycles the major regions. Each region root carries `data-focus-region` and `tabIndex={-1}`;
`keyboard/focusRegions.ts` finds the region holding focus and moves to the next one.

## Shell layout

`components/shell/AppShell.tsx` is the frame: title bar, optional command bar, then a row of rail,
left panel, workspace and right panel, then the status bar. Panel visibility, widths and the active
panel live in settings, so the layout survives a restart. While a divider is dragged the width comes
from the gesture and is written to settings once, on release.

## Background jobs

`stores/jobStore.ts` implements the job model from `CLAUDE.md` section 36 (state, current item,
counts, cancellable, result path) and the progress centre renders from it. Long operations register
here as they are built; the heavy work itself belongs in workers, utility processes or native
sidecars, never on the renderer's event loop.

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
