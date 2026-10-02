# PaperForge

PaperForge is an offline-first PDF workspace for Windows. It is being built to cover the everyday
work people do with a PDF tool — read, annotate, organize, edit, recognize text, convert, protect
and redact — on a local machine, with no account, no telemetry and no cloud services.

**Status: early development.** This repository currently contains Segments 0 to 13 of the build plan
in [`CLAUDE.md`](./CLAUDE.md):

- the secure Electron foundation and the Fluent Workspace shell with its command system;
- the file layer — tabs, recent files, watching, session restore, crash recovery;
- the viewer: PDFs render with selectable text, working links, zoom, rotation and password support;
- the way around a document: page thumbnails, bookmarks, attachments, layers, page labels, reading
  mode, and text search across pages and open documents;
- the foundation every editing feature builds on: changes applied to a working copy, undo and redo
  by revision, and a save pipeline that reopens what it wrote before it replaces your file;
- commenting: highlights, notes, shapes, freehand ink and stamps, written into the PDF as real
  annotations, with a comments panel that lists them;
- organizing pages: a grid of the whole document to reorder, rotate, duplicate, delete, insert,
  replace, crop and renumber, with extraction and splitting into new files;
- making documents: a blank one, or one made from images, text files, local web pages and other
  PDFs — with the pages each file contributes, their order, and bookmarks naming where they came
  from;
- editing text: PaperForge reads a page's content stream itself, so a line can be rewritten in the
  font that drew it, replaced in a standard font when that font cannot write it, or added where
  you click;
- editing images and links: move, resize, turn, crop, replace, fade, export or delete a picture the
  page draws, and make or change the links it carries;
- watermarks, backgrounds, headers and footers, with page numbers, dates, titles and Bates
  numbering — marked as PaperForge's own, so they can be changed or taken off again;
- forms: fill one in, make one, and sign it with a mark you draw, type or bring in as a picture —
  with totals PaperForge works out itself rather than by running a script, and flattening when you
  want the result to be part of the page.

- recognising text: a scan is read by the local Tesseract program, and the words go on invisibly
  over the picture, so the page still looks like a scan and its words can be found. Nothing is
  uploaded and nothing is downloaded.

- exporting: pictures of the pages, the words as text, a web page, Word, Excel or PowerPoint —
  each one saying what it carries and what it loses — and Office documents converted by a local
  LibreOffice when there is one.

- document administration: properties and metadata, attachments, removing hidden information,
  and password protection through a local qpdf.

- redaction: mark text, areas or every occurrence of a phrase, review what each mark takes, and
  apply — the content under the marks is removed from the file, not covered, and each page is read
  back to prove it.

Comparison, optimisation and repair arrive in later segments.

[`PROGRESS.md`](./PROGRESS.md) is the authoritative status file.

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

| Tool        | Used for                                | Status in this build                               |
| ----------- | --------------------------------------- | -------------------------------------------------- |
| qpdf        | encryption, repair, structural rewrites | optional; used to check saved files when installed |
| Tesseract   | local OCR                               | not integrated yet                                 |
| LibreOffice | optional Office-to-PDF conversion       | not integrated yet                                 |

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
- [`docs/EDITING_MODEL.md`](./docs/EDITING_MODEL.md) — how a change is applied, undone and saved
- [`docs/ANNOTATIONS.md`](./docs/ANNOTATIONS.md) — how comments are written into the PDF itself
- [`docs/PAGE_ORGANIZATION.md`](./docs/PAGE_ORGANIZATION.md) — the page grid, and how pages leave a document
- [`docs/FORMS.md`](./docs/FORMS.md) — filling a form in, making one, signing it, and flattening
- [`docs/OCR_PIPELINE.md`](./docs/OCR_PIPELINE.md) — how a scan is read, and where each step runs
- [`docs/CONVERSION_PIPELINE.md`](./docs/CONVERSION_PIPELINE.md) — how a file becomes a PDF, and how documents are combined
- [`docs/SECURITY.md`](./docs/SECURITY.md) — the Electron security baseline PaperForge holds itself to
- [`docs/DEPENDENCIES.md`](./docs/DEPENDENCIES.md) — why each dependency is here, and its license
- [`docs/KEYBOARD_SHORTCUTS.md`](./docs/KEYBOARD_SHORTCUTS.md) — planned and implemented shortcuts
- [`docs/QA_CHECKLIST.md`](./docs/QA_CHECKLIST.md) — manual checks per segment
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) — third-party licenses

## License

MIT — see [`LICENSE`](./LICENSE).
