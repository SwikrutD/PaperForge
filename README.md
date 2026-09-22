# PaperForge

PaperForge is an offline-first PDF workspace for Windows. It is being built to cover the everyday
work people do with a PDF tool — read, annotate, organize, edit, recognize text, convert, protect
and redact — on a local machine, with no account, no telemetry and no cloud services.

**Status: early development.** This repository currently contains Segments 0 to 4 of the build plan
in [`CLAUDE.md`](./CLAUDE.md): the secure Electron foundation, the Fluent Workspace shell with its
command system, the file layer (tabs, recent files, watching, session restore, crash recovery), the
viewer — PDFs render with selectable text, working links, zoom, rotation and password support — and
the way around a document: page thumbnails, bookmarks, attachments, layers, page labels, reading
mode and text search across pages and open documents. Annotating, organising and editing arrive in
later segments. [`PROGRESS.md`](./PROGRESS.md) is the authoritative status file.

## Principles

- Windows-first, offline-first, local files only.
- No accounts, no telemetry, no cloud storage, no AI features.
- Never destroy the user's only copy: writes are atomic and originals stay intact.
- Honest capabilities — no button that pretends to do something it cannot.

## Requirements

- Windows 10 or 11 (x64)
- Node.js 20.19 or newer (developed on Node 24)
- npm 10 or newer

Optional local tools used by later segments — none are downloaded at runtime:

| Tool        | Used for                                | Status in this build |
| ----------- | --------------------------------------- | -------------------- |
| qpdf        | encryption, repair, structural rewrites | not integrated yet   |
| Tesseract   | local OCR                               | not integrated yet   |
| LibreOffice | optional Office-to-PDF conversion       | not integrated yet   |

## Development

```sh
npm install     # npm >= 11 asks once to approve Electron's install script
npm run dev     # Vite dev server + Electron window with hot reload
```

Quality gates, all of which must stay green:

```sh
npm run typecheck   # four strict TypeScript projects: tooling, main, renderer, tests
npm run lint        # ESLint with type-aware rules
npm test            # Vitest unit tests
npm run test:e2e    # packages the app, then runs the Playwright end-to-end suite
npm run format      # Prettier
```

Packaging:

```sh
npm run package     # unpacked app in out/PaperForge-win32-x64
npm run make        # distributable archive in out/make
npm run icons       # regenerate resources/icons from scripts/generate-icon.mjs
```

The Windows installer, file associations and "Open with" support arrive in Segment 18.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — process model, layering, IPC
- [`docs/SECURITY.md`](./docs/SECURITY.md) — the Electron security baseline PaperForge holds itself to
- [`docs/DEPENDENCIES.md`](./docs/DEPENDENCIES.md) — why each dependency is here, and its license
- [`docs/KEYBOARD_SHORTCUTS.md`](./docs/KEYBOARD_SHORTCUTS.md) — planned and implemented shortcuts
- [`docs/QA_CHECKLIST.md`](./docs/QA_CHECKLIST.md) — manual checks per segment
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) — third-party licenses

## License

MIT — see [`LICENSE`](./LICENSE).
