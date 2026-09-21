# PaperForge — Claude Code Master Build Specification

> **Purpose:** This file is the persistent project specification for Claude Code.  
> **Product:** PaperForge — a Windows-only, offline-first PDF viewer/editor intended to cover roughly 80–90% of the practical workflows people use Adobe Acrobat/Acrobat Pro for, while using a clean modern Fluent Workspace interface.
>
> **How to use this file:** Start Claude Code in the empty PaperForge repository and say:
>
> `Read CLAUDE.md, inspect the repository, then execute ONLY the next incomplete segment. Follow every gate and update PROGRESS.md before stopping.`
>
> Do **not** try to build the entire application in one context window. This document intentionally divides the work into independently testable segments.

---

# 0. NON-NEGOTIABLE EXECUTION PROTOCOL

You are the principal engineer for this project. You are responsible for architecture, implementation, tests, build scripts, local documentation, and keeping the repository runnable after every segment.

## 0.1 Work one segment at a time

1. Read this entire `CLAUDE.md`.
2. Read `PROGRESS.md` if it exists.
3. Inspect the actual repository state. Never assume a previous segment is complete solely because `PROGRESS.md` says so.
4. Identify the first incomplete segment whose prerequisites are satisfied.
5. Implement **only that segment and any tiny prerequisite fix needed for it**.
6. Run the segment's required validation commands.
7. Fix failures before stopping.
8. Update `PROGRESS.md` with:
   - segment completed;
   - key files changed;
   - architecture decisions made;
   - tests/build commands run and their result;
   - known limitations;
   - exact next segment;
   - any manual setup required.
9. If the segment is genuinely complete, make a git commit if git is initialized. Use a clear message such as:
   - `feat(viewer): implement virtualized PDF rendering`
   - `feat(ocr): add local searchable PDF pipeline`
   - `feat(editor): add text and image editing`
10. Stop after the segment and give a concise completion report. Do not automatically continue into the next major segment unless the user explicitly asks.

## 0.2 No fake completion

Never satisfy a feature by adding a button that does nothing, a permanent mock dialog, dummy data, a toast saying "coming soon", or a TODO-only implementation.

A feature may be hidden behind a development flag while incomplete. It may not be presented as working until it actually works.

If a requested capability is technically limited by the chosen open-source stack, implement the strongest reliable behavior possible, document the limitation precisely, and keep the architecture extensible. Do not silently pretend to provide Acrobat-equivalent behavior where the PDF format or libraries do not permit it.

## 0.3 Build quality

At the end of every segment, the repository must remain:

- installable;
- type-safe;
- lintable;
- launchable;
- testable;
- usable without network access for already-installed dependencies and bundled/local tools;
- free of obvious dead code and placeholder UX;
- secure under Electron desktop-app best practices.

Prefer small composable modules over giant files. In normal source code, aim to keep files below roughly 400 lines unless a generated file or a strongly cohesive parser warrants more.

## 0.4 Do not rewrite working subsystems casually

Before changing an established subsystem:

- inspect its tests;
- identify its public interfaces;
- preserve behavior unless the current segment explicitly changes it;
- add regression tests for a bug before fixing it when practical.

## 0.5 Ask questions only for real blockers

Do not stop for routine implementation choices. Make sensible engineering decisions consistent with this document. Ask only when an irreversible product decision, missing legal asset, or genuinely unavailable external binary prevents progress.

---

# 1. PRODUCT VISION

Build **PaperForge**, a polished Windows desktop PDF workspace that feels like a modern successor to Acrobat rather than a web page wrapped in a desktop shell.

Core principles:

- **Windows-first.**
- **Offline-first.**
- **Local files only.**
- **No accounts.**
- **No telemetry by default.**
- **No cloud storage integration.**
- **No AI features.**
- **No scanner integration.**
- **No remote e-signature workflow.**
- **No cryptographic certificate signing in v1.**
- **Simple Fill & Sign signatures are required.**
- **Fast viewer first, professional editing second.**
- **Preserve the original document whenever possible.**
- **Never destroy the user's only copy.**
- **Every destructive operation must be undoable before save or performed on a safe temporary copy.**

The practical target is 80–90% of common Acrobat/Acrobat Pro use cases, not a clone of every obscure PDF specification feature.

PaperForge must have its own identity. Do not copy Adobe trademarks, proprietary icons, exact layouts, or branded wording where a generic term works.

---

# 2. CHOSEN TECHNOLOGY STACK

Use the following architecture unless a segment proves a component unusable.

## 2.1 Desktop shell

- **Electron**
- **Electron Forge** or a similarly mature Electron packaging workflow
- Windows x64 first
- Add arm64 only after x64 is stable
- Use a frameless or lightly customized Windows title bar only if native window behavior remains reliable
- Prefer Windows-native keyboard/menu conventions

Why Electron: the project needs mature Chromium canvas/text rendering, PDF.js compatibility, worker support, native filesystem access through controlled IPC, straightforward sidecar execution, and fast iteration in Claude Code.

## 2.2 Frontend

- React
- TypeScript with strict mode
- Vite
- Fluent UI React Components for core controls where it helps
- Custom CSS design tokens for the PaperForge visual system
- `lucide-react` or Fluent icons for generic icons; do not copy Acrobat icons
- Zustand for app/workspace state
- Zod for IPC payload validation and persisted settings validation
- TanStack Virtual or equivalent permissively licensed virtualization for long page lists
- React Error Boundaries around document workspaces and heavy panels

Use native/system typography:

- Segoe UI Variable if available
- Segoe UI fallback
- system-ui fallback

Do not fetch fonts from the internet.

## 2.3 PDF rendering and high-level document work

Primary:

- **PDF.js** for rendering, text extraction, text selection, annotations display, optional-content/layer visibility where supported, document metadata, and page geometry.
- **pdf-lib** for PDF creation and many page/content/form/annotation write operations where appropriate.
- **qpdf** as a local native sidecar for robust structural operations such as encryption/decryption, inspection, repair attempts, splitting/merging, linearization, and transformations that are safer at object level.

Create internal interfaces so a future engine can be added without rewriting the UI:

- `PdfRenderEngine`
- `PdfMutationEngine`
- `PdfStructureEngine`
- `OcrEngine`
- `ConversionProvider`

Do not couple UI components directly to PDF.js or qpdf command strings.

## 2.4 OCR

Use **Tesseract OCR** locally.

Requirements:

- Windows-local binary;
- local tessdata;
- English enabled by default;
- architecture for additional language packs;
- no network calls during OCR;
- progress and cancel support;
- page-range support;
- searchable-PDF output using an invisible text layer aligned to the page;
- retain original page imagery whenever possible.

Do not use cloud OCR.

## 2.5 Conversions

Implement conversions through internal providers.

Native PaperForge conversions:

- PDF -> PNG
- PDF -> JPEG
- PDF -> WebP
- image(s) -> PDF
- PDF -> TXT
- PDF -> HTML
- PDF -> DOCX, best-effort editable export
- PDF -> XLSX, best-effort table/data export
- PDF -> PPTX:
  - fidelity mode: page rendered as slide background;
  - editable mode where practical using extracted text/images
- TXT -> PDF
- HTML -> PDF
- common images -> PDF
- print-to-PDF style creation from supported local content where feasible

For Office -> PDF:

- implement a `LibreOfficeConversionProvider` that invokes a **local** LibreOffice installation via headless `soffice`;
- detect common Windows install locations;
- allow users to configure a local path;
- never download LibreOffice at runtime;
- keep LibreOffice optional so PaperForge itself does not require a network connection;
- the build system may later support a separately staged local conversion pack after license review.

If LibreOffice is unavailable, Office-import UI must explain that the local conversion component is not installed; do not attempt an online service.

Do not use Ghostscript or MuPDF by default because of licensing constraints unless the user explicitly revisits that decision.

## 2.6 Supporting libraries

Prefer permissive libraries with clear licenses. Candidates:

- Zod
- Zustand
- Fluent UI
- Lucide
- TanStack Virtual
- `docx` for DOCX output
- `exceljs` for XLSX output
- `pptxgenjs` for PPTX output
- Vitest
- React Testing Library
- Playwright for Electron end-to-end tests

Before adding any package:

1. inspect its license;
2. avoid AGPL/GPL dependencies in the core product unless explicitly approved;
3. record third-party licenses.

Create:

- `THIRD_PARTY_NOTICES.md`
- `docs/DEPENDENCIES.md`

Use exact lockfile versions. Do not depend on floating CDN assets.

---

# 3. LICENSING AND DISTRIBUTION RULES

The intent is to keep PaperForge practical for eventual redistribution.

Current preferred core:

- Electron — MIT
- React — MIT
- Vite — MIT
- PDF.js — Apache-2.0
- qpdf — Apache-2.0
- Tesseract — Apache-2.0
- pdf-lib — MIT

Claude must verify actual licenses for the versions chosen and update `THIRD_PARTY_NOTICES.md`.

Rules:

- Never remove upstream copyright/license notices.
- Do not casually introduce AGPL code.
- Treat LibreOffice as an optional local integration unless packaging/legal review is explicitly performed.
- Do not use proprietary Adobe SDKs.
- Do not use online conversion APIs.
- Do not download external executables at runtime.
- Development setup scripts may assist the developer in staging local sidecars, but production behavior must remain offline.

This file is an engineering specification, not legal advice. Keep license metadata auditable.

---

# 4. PROJECT STRUCTURE

Use a structure close to:

```text
paperforge/
  CLAUDE.md
  PROGRESS.md
  README.md
  LICENSE
  THIRD_PARTY_NOTICES.md
  package.json
  forge.config.ts
  tsconfig*.json
  vite.*.config.ts

  docs/
    ARCHITECTURE.md
    DEPENDENCIES.md
    EDITING_MODEL.md
    OCR_PIPELINE.md
    CONVERSION_PIPELINE.md
    SECURITY.md
    KEYBOARD_SHORTCUTS.md
    QA_CHECKLIST.md

  resources/
    icons/
    app/
    bundled-tools/        # staged binaries, normally ignored until packaged
    tessdata/             # staged OCR language data

  src/
    main/
      index.ts
      windows/
      ipc/
      services/
        filesystem/
        qpdf/
        tesseract/
        libreoffice/
        printing/
        recovery/
        recentFiles/
    preload/
      index.ts
      api.ts
    renderer/
      app/
      routes/
      components/
      design-system/
      workspace/
      viewer/
      editor/
      annotations/
      forms/
      signatures/
      organize/
      compare/
      ocr/
      protect/
      convert/
      accessibility/
      preflight/
      settings/
      stores/
      hooks/
      utils/
    shared/
      types/
      schemas/
      constants/
      commands/
      errors/
    pdf/
      render/
      mutate/
      structure/
      content-parser/
      text-edit/
      image-edit/
      annotations/
      forms/
      bookmarks/
      attachments/
      metadata/
      security/
      sanitize/
      compare/
      optimize/
      accessibility/
      io/
    conversion/
      providers/
      models/
    workers/
      render.worker.ts
      ocr.worker.ts
      compare.worker.ts

  tests/
    unit/
    integration/
    e2e/
    fixtures/
    visual/
```

Adjust only when a better separation is justified.

---

# 5. SECURITY MODEL

Electron security is mandatory.

Use:

- `contextIsolation: true`
- `nodeIntegration: false`
- sandboxing where compatible
- a narrow preload API
- typed IPC
- Zod validation at every IPC boundary
- no arbitrary command execution from renderer
- no renderer access to unrestricted filesystem paths
- no `eval`
- no remote module
- no external navigation without explicit user confirmation
- strict Content Security Policy compatible with PDF.js workers
- safe temporary-directory handling
- path normalization and traversal protection

Native sidecars:

- invoked only by main-process service wrappers;
- arguments constructed from typed fields, not shell-concatenated strings;
- prefer `spawn`/`execFile` without a shell;
- quote/path handling tested with spaces and Unicode filenames;
- temporary outputs placed under PaperForge-owned temp directories;
- cancellation must terminate child processes cleanly;
- stderr surfaced as structured error details.

PDFs are untrusted files. Avoid executing document JavaScript. PaperForge may inspect and remove PDF JavaScript actions, but must **not execute arbitrary embedded PDF JavaScript**.

Embedded file attachments:

- never auto-open;
- never auto-execute;
- save/open only after explicit action;
- warn for executable/script extensions.

---

# 6. FLUENT WORKSPACE DESIGN SYSTEM

Theme: **Fluent Workspace**, with complete light and dark modes.

The app should feel like:

- Windows 11;
- Microsoft 365;
- a professional engineering/editor workspace;
- modern and restrained, not playful;
- more spatially efficient than current Acrobat.

## 6.1 Layout

Primary application shell:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Title/tab bar: PaperForge | document tabs | window controls         │
├─────────────────────────────────────────────────────────────────────┤
│ Menu/command bar: File Edit View Convert Organize Sign Protect ... │
├──────┬────────────────────┬───────────────────────────┬─────────────┤
│ Left │ contextual left    │                           │ Right       │
│ rail │ panel              │       PDF workspace       │ properties  │
│      │ thumbnails         │                           │ / tools     │
│      │ bookmarks          │                           │             │
│      │ attachments        │                           │             │
│      │ layers             │                           │             │
├──────┴────────────────────┴───────────────────────────┴─────────────┤
│ status: page | selection | zoom | fit | rotation | render status   │
└─────────────────────────────────────────────────────────────────────┘
```

The user can:

- collapse left panel;
- collapse right panel;
- resize panels;
- hide toolbars;
- use F11-style reading mode/full screen;
- open command palette with `Ctrl+K`.

## 6.2 Home screen

When no document is open, show a polished home page.

Sections:

- Open PDF
- Create PDF
- Recent files
- Pinned files
- Tools

Tool cards should include:

- Edit PDF
- Create PDF
- Export PDF
- Combine Files
- Organize Pages
- Comment
- Fill & Sign
- OCR / Recognize Text
- Protect
- Redact
- Compress / Optimize
- Compare Files
- Prepare Form
- Accessibility
- Metadata / Document Properties

Do not include "Request E-signatures"; remote e-sign workflow is outside scope.

Cards should be compact and modern, not huge.
Use colorful icon accents sparingly while keeping the workspace neutral.

## 6.3 Color and surfaces

Create semantic design tokens, never scatter literal colors across components.

Light:

- warm/neutral near-white app background;
- white document/tool surfaces;
- subtle cool-gray dividers;
- Windows-style blue accent;
- high-contrast primary text;
- muted secondary text.

Dark:

- near-black charcoal background, not pure black;
- dark gray surfaces with clear hierarchy;
- document page remains white by default;
- optional "dim page surroundings";
- accessible blue accent.

Support:

- Light
- Dark
- Follow system

Persist setting locally.

## 6.4 Density

Default desktop density:

- compact but not cramped;
- 32–36 px common toolbar controls;
- 6–8 px radii for most controls;
- 10–12 px for larger cards/dialogs;
- minimal shadow; use borders and elevation sparingly.

## 6.5 Interaction standards

Every toolbar icon must have:

- tooltip;
- accessible label;
- keyboard focus;
- disabled state;
- hover state;
- pressed/active state when applicable.

Contextual tools:

- selecting text reveals text-edit controls;
- selecting an image reveals image controls;
- selecting an annotation reveals annotation properties;
- selecting a form field reveals field properties.

Do not flood the UI with all controls at once.

---

# 7. GLOBAL UX AND COMMAND MODEL

Create a central command registry.

A command includes:

- id;
- title;
- description;
- category;
- icon;
- default shortcut;
- enable predicate;
- execute function;
- optional checked state.

All menus, toolbar buttons, context menus, and command palette entries should call the same command implementation.

Important commands and suggested shortcuts:

```text
Ctrl+O            Open
Ctrl+Shift+O      Open recent / open options
Ctrl+S            Save
Ctrl+Shift+S      Save As
Ctrl+W            Close tab
Ctrl+Shift+W      Close window
Ctrl+P            Print
Ctrl+F            Find
Ctrl+H            Find options / advanced search
Ctrl+Z            Undo
Ctrl+Y            Redo
Ctrl+C/X/V        Copy/Cut/Paste where valid
Ctrl+A            Select all in current context
Ctrl++ / Ctrl+-   Zoom
Ctrl+0            Fit page
Ctrl+1            Actual size
Ctrl+2            Fit width
Ctrl+K            Command palette
F4                Toggle right tools pane
F6                Cycle major regions
F11               Full screen / reading mode
PageUp/PageDown   Previous/next page
Home/End          First/last page when viewer focused
```

Use standard Windows accelerators where appropriate.

---

# 8. DOCUMENT WORKSPACE MODEL

Support multiple open documents.

Each tab stores:

- file path;
- display name;
- fingerprint/document id;
- dirty state;
- current page;
- zoom;
- scroll position;
- active tool;
- side panel state;
- selection;
- undo/redo stack;
- temporary working file path;
- recovery journal;
- document capabilities;
- encryption state.

Required:

- tabs;
- tab reordering;
- pinning;
- close others;
- close to right;
- duplicate view;
- split view;
- side-by-side documents;
- independent zoom per pane;
- synchronized page/scroll option;
- drag file onto app;
- drag file onto tab strip;
- open in new window;
- restore previous session option.

Warn clearly before closing dirty documents.

---

# 9. FILE SAFETY, RECOVERY, AND SAVE MODEL

Never edit the original file directly while an operation is in progress.

Open flow:

1. validate file exists;
2. read enough bytes to identify PDF;
3. detect encryption;
4. load through engine;
5. create working session metadata;
6. render first visible page quickly;
7. lazily load remaining metadata/thumbnails.

Save flow:

1. write to temporary sibling or app temp file;
2. validate resulting PDF can reopen;
3. optionally qpdf-check it;
4. fsync/close;
5. atomically replace destination where Windows permits;
6. preserve backup/recovery data until success.

Implement:

- Save;
- Save As;
- Save a Copy;
- Revert to Saved;
- autosave recovery journal;
- crash recovery screen;
- recent files;
- pinned files;
- missing-file handling;
- file changed externally detection;
- read-only file behavior;
- long path/Unicode path support.

"Incremental saving" in PaperForge has two meanings:

1. **internal incremental recovery journal** — required;
2. byte-level incremental PDF update — use only for operations where the engine safely supports it. Do not claim universal byte-level incremental save if the write engine rewrites the file.

Undo/redo:

- command-based;
- document-local;
- supports grouped transactions;
- clear history after successful save only if architecture requires it; preferably preserve recent logical history while document remains open.

---

# 10. VIEWER — REQUIRED BEHAVIOR

The viewer is foundational and must be excellent before advanced editing.

Required:

- smooth continuous scroll;
- single page;
- two-page spread;
- cover page option;
- fit page;
- fit width;
- actual size;
- custom zoom;
- mouse wheel zoom with Ctrl;
- high-DPI rendering;
- page rotation;
- temporary view rotation and persistent page rotation as distinct operations;
- text selection;
- copy text;
- hand/pan tool;
- select tool;
- marquee zoom;
- links;
- internal destinations;
- document outline/bookmarks;
- thumbnails;
- attachments panel;
- layers/optional-content panel where supported;
- page labels;
- status bar page navigation;
- smooth page jump;
- search highlights;
- annotation rendering;
- form rendering;
- night workspace without recoloring document contents;
- presentation/full-screen mode.

Performance:

- render only visible/near-visible pages;
- cancel renders that scroll far off-screen;
- use worker threads;
- render thumbnails lazily;
- cache page canvases within a bounded memory budget;
- degrade gracefully on 1,000+ page PDFs;
- release page resources when tabs close.

---

# 11. SEARCH

Implement robust local search.

Basic:

- find next/previous;
- case sensitivity;
- whole word;
- highlight all;
- match count;
- search current document.

Advanced:

- search all open PDFs;
- search selected page range;
- regex optional only if implementation is safe and understandable;
- search bookmarks/annotations optionally.

Scanned PDFs:

- if there is no useful text layer, offer local OCR.

Search must never require Internet access.

---

# 12. ANNOTATIONS / COMMENT

Implement standard practical annotation types:

- highlight;
- underline;
- strikethrough;
- squiggly underline;
- free-text/text box;
- sticky note;
- callout;
- rectangle;
- ellipse;
- line;
- arrow;
- polygon;
- polyline if practical;
- freehand ink;
- eraser for ink;
- stamp with built-in generic stamps;
- custom image stamp;
- attachment annotation if supported;
- measurement annotations can be added later in the practical-tools segment.

Properties:

- color;
- opacity;
- line width;
- line style;
- font size;
- font;
- text color;
- fill color;
- author;
- subject;
- created/modified date where appropriate.

Comments panel:

- list annotations by page;
- sort;
- filter by type/author/status;
- click comment to navigate;
- edit comment text;
- delete;
- mark resolved if represented in PaperForge metadata;
- export/import XFDF if practical.

Annotations should be written as real PDF annotations where supported, not merely stored in an app-private database.

---

# 13. EDIT PDF — DEEP EDITING REQUIREMENTS

This is a major subsystem. Do not implement it as a simple overlay-only mode and call it complete.

## 13.1 Object selection

When Edit PDF is active:

- detect selectable text runs/blocks;
- detect raster image XObjects where possible;
- allow selection handles;
- bounding boxes;
- drag;
- resize;
- rotate;
- alignment guides;
- snap modifier;
- delete;
- duplicate;
- z-order for PaperForge-added objects where valid.

## 13.2 Text editing architecture

Create a dedicated PDF content parser for the common PDF text operator set.

Handle enough of:

- `BT` / `ET`
- `Tf`
- `Tm`
- `Td`
- `TD`
- `T*`
- `Tj`
- `TJ`
- `'`
- `"`
- `Tc`
- `Tw`
- `Tz`
- `TL`
- `Tr`
- `Ts`
- graphics transforms needed to resolve coordinates
- font resource lookup
- ToUnicode maps where available
- simple encodings
- embedded font metadata where accessible

Build an internal model that maps visible text spans to source content-stream ranges when this can be done safely.

Editing strategy tiers:

### Tier A — native rewrite

For common PDFs where glyph-to-content mapping is reliable:

- edit the source text operand/content stream;
- preserve font and styling;
- update positioning as required;
- keep unaffected objects unchanged.

### Tier B — object replacement

When exact source rewrite is not safe:

- remove/neutralize the original visible object region using a standards-safe content update;
- insert replacement text;
- match font, size, color, baseline, rotation, and spacing as closely as possible;
- expose a subtle compatibility indicator in the properties panel if font substitution occurred.

### Tier C — explicit fallback

For highly complex text such as custom glyph encodings, malformed content, or unsupported shaping:

- do not silently corrupt the PDF;
- allow the user to create replacement text;
- clearly label the operation internally as compatibility replacement;
- preserve original file via undo/recovery.

## 13.3 Paragraph editing

For selected text block:

- multiline editing;
- font family;
- size;
- bold/italic when available or substitute;
- color;
- alignment;
- line spacing;
- character spacing;
- paragraph box resizing;
- basic reflow within the detected/defined text box;
- spellcheck can use Chromium local spellcheck if it does not require cloud access.

Do not promise word-processor-quality full-document semantic reflow. PDFs are fixed-layout documents.

## 13.4 Font handling

- use embedded font where technically editable;
- support Windows system fonts;
- embed replacement font subsets where licensing permits;
- never redistribute a font merely because it exists on the developer machine;
- warn if embedding rights prohibit embedding;
- use safe fallback fonts;
- include font substitution in document change metadata.

## 13.5 Image editing

For detectable page images:

- select;
- move;
- resize;
- rotate;
- crop;
- replace from local image file;
- opacity where supported;
- flip horizontal/vertical;
- reset crop;
- export original image when extractable.

Prefer replacing the referenced image object when safe. Use content-layer replacement when direct replacement is not safe.

## 13.6 Add content

- add text box;
- add image;
- add hyperlink;
- edit hyperlink;
- add simple shape;
- add page number;
- add header/footer;
- add watermark;
- add background.

## 13.7 Headers / footers / Bates numbering

Support:

- page number token;
- total pages token;
- date token;
- document title token;
- custom text;
- left/center/right positions;
- top/bottom;
- font/size/color;
- page range;
- margins;
- preview;
- remove/update existing PaperForge-generated header/footer;
- Bates numbering:
  - prefix;
  - number width;
  - start number;
  - suffix;
  - page range;
  - preview.

---

# 14. ORGANIZE PAGES

Create a thumbnail-grid workspace optimized for structural operations.

Required:

- reorder via drag/drop;
- multi-select;
- shift-select ranges;
- rotate left/right;
- delete;
- duplicate;
- extract;
- split;
- insert from PDF;
- insert blank page;
- insert image as page;
- replace page;
- move pages between open documents;
- crop pages;
- page labels;
- page boxes inspector where practical.

Extract options:

- selected pages to one PDF;
- each page to separate PDF;
- delete after extraction optional.

Split options:

- every N pages;
- by page ranges;
- by top-level bookmarks where feasible;
- by target file size only if reliable enough.

All structural actions participate in undo/redo prior to save.

---

# 15. CREATE / COMBINE PDF

## 15.1 Create PDF

Create from:

- blank page;
- image(s);
- TXT;
- HTML file;
- Office document using local LibreOffice provider;
- multiple mixed local files where conversion is supported.

Creation dialog:

- paper size;
- portrait/landscape;
- margins;
- initial metadata;
- image fit behavior.

## 15.2 Combine Files

Dedicated combine workspace:

- add files;
- drag/drop;
- reorder;
- show page/file counts;
- preview thumbnails;
- rotate source pages where applicable;
- choose all pages or ranges per file;
- remove source;
- combine into a new PDF;
- preserve bookmarks where practical;
- optionally create top-level bookmark per source file;
- never modify source files.

---

# 16. EXPORT / CONVERT

Create a conversion center with explicit modes.

## PDF to image

- PNG/JPEG/WebP;
- current page/all pages/range;
- 72/96/150/300/600 DPI;
- quality control where applicable;
- transparent background where meaningful;
- output naming template.

## PDF to text

- plain reading-order text;
- layout-preserving text option;
- selected pages;
- OCR prompt if no text.

## PDF to HTML

- local asset directory;
- text + images;
- reasonable page structure;
- no remote assets.

## PDF to DOCX

Best effort:

- paragraphs from text blocks;
- headings inferred conservatively;
- images;
- page breaks;
- basic tables when detected;
- selectable "flowing document" vs "layout fidelity" export where feasible.

## PDF to XLSX

Best effort:

- detect table-like regions;
- one sheet per detected table/page option;
- preserve strings/numbers separately when confident;
- do not fabricate formulas.

## PDF to PPTX

Modes:

- fidelity: one PDF page rendered per slide background;
- editable: extracted text/images where feasible.

## Local Office to PDF

Via `LibreOfficeConversionProvider`:

- DOC/DOCX/ODT;
- XLS/XLSX/ODS;
- PPT/PPTX/ODP;
- supported local office formats.

Expose provider availability in Settings > Conversions.

---

# 17. OCR / RECOGNIZE TEXT

OCR UI:

- current page;
- selected pages;
- all pages;
- language(s);
- output:
  - searchable PDF;
  - extracted text;
- image preprocessing toggle;
- keep original visual appearance;
- progress per page;
- overall progress;
- cancel.

Pipeline:

1. render page to image at suitable DPI;
2. orientation detection;
3. optional grayscale/contrast cleanup;
4. OCR through local Tesseract;
5. collect words, confidence, bounding boxes, baseline if available;
6. map pixel coordinates back to PDF coordinates;
7. create invisible searchable text layer;
8. preserve original raster image/page content;
9. validate extracted text exists;
10. save through normal safe-save pipeline.

Provide confidence diagnostics but do not clutter normal UI.

OCR should be resumable at page boundaries after cancellation/failure where practical.

Language packs:

- local folder;
- settings page listing installed packs;
- user may browse to an existing tessdata directory;
- no network downloader in v1.

---

# 18. FILL & SIGN

No remote e-sign requests and no PKI certificate signatures in v1.

Required:

- fill AcroForm text fields;
- checkboxes;
- radio buttons;
- combo boxes;
- list boxes;
- buttons where safe;
- tab navigation;
- highlight fields;
- required-field validation when declared.

Simple signatures:

- draw with mouse/stylus;
- type name using a small set of local/system style choices;
- import signature image;
- transparent background cleanup for imported signature where feasible;
- save signatures **locally** only if user opts in;
- place;
- resize;
- rotate;
- duplicate;
- delete before save.

Also support:

- initials;
- date stamp;
- free text.

Flatten:

- flatten selected form fields;
- flatten all form fields;
- flatten signatures/annotations with explicit warning.

A simple signature is a visual mark, not a cryptographic digital signature. The UI must not imply certificate validation.

---

# 19. PREPARE FORM

Practical AcroForm authoring:

Create:

- text field;
- multiline text field;
- checkbox;
- radio group;
- combo box;
- list box;
- push button;
- signature placeholder field as a generic visual/form field, not a cryptographic signer.

Properties:

- name;
- tooltip;
- default value;
- required;
- read-only;
- font/size;
- text color;
- border/fill;
- alignment;
- max characters;
- multiline;
- password/masked field where PDF form semantics support it;
- calculation order where practical;
- basic numeric/date validation templates;
- simple calculations such as sum/product/average using PaperForge-generated safe field logic.

Do not execute arbitrary document JavaScript. If a PDF contains JS-based form actions, inspect/display their existence but do not run them.

Form field auto-detection is optional and may be heuristic/local only. No AI.

---

# 20. PROTECT / SECURITY

Use qpdf where it is the most reliable engine.

Required:

- encrypt with password;
- open/user password;
- owner/permissions password if supported by selected qpdf flow;
- printing permission;
- editing permission;
- copy/extract permission;
- annotation/form permission;
- inspect security summary;
- remove security when the user supplies the required password and the operation is legally/technically permitted;
- save protected copy.

Do not claim DRM-grade prevention. PDF permissions are cooperative controls and may not stop all software.

Security dialog must clearly distinguish:

- password required to open;
- permissions restrictions.

Never log passwords.

---

# 21. REDACTION

Redaction must be real content removal on apply, not a black rectangle annotation.

Workflow:

1. mark text or rectangular region;
2. show pending redaction overlay;
3. optional reason label;
4. search-and-mark text across pages;
5. review all marks;
6. Apply Redactions;
7. remove/neutralize underlying text/image content for marked regions as robustly as the engine permits;
8. optionally sanitize hidden information;
9. save as a new file by default;
10. verify removed text is not returned by text extraction/search.

Add automated regression tests proving redacted sample text cannot be extracted afterward.

For hard cases involving complex content streams, prefer safe rasterization of the affected page region/page over leaving recoverable content beneath an overlay. Preserve vector content when safe.

---

# 22. SANITIZE / REMOVE HIDDEN INFORMATION

Provide a document sanitation report and selectable cleanup.

Detect/remove where practical:

- metadata;
- custom metadata;
- hidden annotations;
- file attachments;
- embedded files;
- comments;
- form data;
- document JavaScript/actions;
- launch actions;
- hidden layers;
- alternate images where identifiable;
- thumbnails;
- incremental-history remnants when doing a full rewrite;
- unused objects where qpdf rewrite removes them.

Never execute embedded actions.

Provide:

- scan;
- results by category;
- select categories;
- save sanitized copy;
- post-save verification.

---

# 23. METADATA / DOCUMENT PROPERTIES

Document Properties dialog:

- title;
- author;
- subject;
- keywords;
- creator;
- producer;
- creation date;
- modified date;
- PDF version;
- page count;
- page sizes summary;
- file size;
- fast-web-view/linearized state where detectable;
- tagged-PDF indicator;
- encryption/security summary;
- fonts list where available;
- initial view preferences;
- custom metadata view.

Allow editing common metadata fields and removing metadata.

---

# 24. BOOKMARKS / LINKS / DESTINATIONS

Bookmarks:

- view outline;
- add;
- rename;
- delete;
- reorder;
- nest;
- expand/collapse;
- set target to current view;
- style bold/italic/color if supported.

Links:

- detect and navigate existing links;
- create rectangle link;
- edit target;
- internal page destination;
- external HTTPS/HTTP URL;
- `mailto:` only after user confirmation when launched externally;
- file links should be treated cautiously.

External URL opening must prompt or use a safe allow-flow.

---

# 25. ATTACHMENTS

Attachments panel:

- list embedded files;
- show name, size, MIME/type when known;
- save attachment;
- add attachment;
- delete attachment;
- rename if PDF representation permits;
- never auto-open;
- warn before opening executable/script-like files.

---

# 26. COMPARE FILES

Local-only visual/text comparison.

Modes:

- side-by-side;
- overlay/difference;
- text changes summary where text extraction is available.

Pipeline:

- normalize page pairing by index initially;
- allow manual page offset;
- render comparable page images;
- compute local pixel difference in worker;
- extract text and calculate word/line differences;
- classify additions/deletions/changes without AI;
- click result to navigate.

UI:

- left original;
- right revised;
- sync scrolling toggle;
- differences panel;
- previous/next difference;
- filter text/image/layout differences where reliable.

Do not claim legal-semantic understanding.

---

# 27. COMPRESS / OPTIMIZE / REPAIR

## Compress

Offer simple presets:

- Low compression / high quality
- Balanced
- Small file

Possible techniques:

- image downsampling for large raster images;
- JPEG quality adjustment where safe;
- duplicate object cleanup where engine supports it;
- qpdf object stream/linearization options;
- remove unused objects/full rewrite;
- optional metadata cleanup.

Show estimated/current size only when actually known.

## Advanced optimize

Controls:

- target image DPI;
- JPEG quality;
- grayscale handling;
- remove thumbnails;
- remove unused objects;
- subset/retain fonts only when safe;
- linearize.

## Repair

When opening malformed PDFs:

- attempt PDF.js recovery;
- qpdf check;
- qpdf rewrite to recovered copy where possible;
- never overwrite original automatically;
- show diagnostic summary.

---

# 28. CROP / PAGE BOXES

Crop tool:

- draggable crop rectangle;
- apply to current page/range/all;
- margins;
- preserve original media box by default when using crop box;
- reset crop;
- optionally change media box only under an advanced option with warning.

Show:

- MediaBox
- CropBox
- BleedBox
- TrimBox
- ArtBox

Editing all boxes is advanced; support viewing first and editing crop/media where safe.

---

# 29. WATERMARK / BACKGROUND

Watermark:

- text or image;
- opacity;
- rotation;
- scale;
- position;
- page range;
- above/below content;
- preview;
- update/remove PaperForge-generated watermark.

Background:

- solid color;
- local image;
- scale/tile/fit;
- page range;
- update/remove PaperForge-generated background.

---

# 30. ACCESSIBILITY — PRACTICAL SUBSET

Do not attempt to falsely claim full PDF/UA remediation if the stack cannot guarantee it.

Accessibility checker should inspect what can be detected:

- missing document title;
- missing language;
- image alt-text availability where tagged structure exposes it;
- untagged document;
- empty links;
- suspicious reading order;
- form fields missing accessible names/tooltips;
- low-level tagging indicators;
- scanned image-only pages without text.

Provide:

- issue list;
- page/object navigation;
- ability to set document title/language;
- edit alt text where the PDF structure permits;
- field tooltip/name fixes;
- OCR shortcut for image-only pages.

Add a reading-order visualization only if backed by real structure/text geometry.

Use wording such as "Accessibility Check" rather than "PDF/UA compliant" unless an actual validator proves it.

---

# 31. LAYERS / OPTIONAL CONTENT

If PDF.js exposes optional content groups:

- layers panel;
- toggle visibility;
- preserve state while viewing;
- optional save of default layer state if write engine safely supports it.

Do not invent layers for PDFs that do not have them.

---

# 32. MEASUREMENT TOOLS — PRACTICAL FEATURE

Add later in the practical-tools segment:

- distance;
- perimeter;
- area;
- page calibration:
  - define known length;
  - select unit;
  - store scale locally or in measurement annotation metadata where practical.

Display results in annotation properties.

---

# 33. PRINTING

Use Windows/Electron printing carefully.

Required:

- current document;
- page ranges;
- current page;
- odd/even where practical;
- copies;
- portrait/landscape;
- scale:
  - fit;
  - actual size;
  - custom;
- auto rotate/center;
- print annotations toggle where implementation supports it;
- system printer selection;
- Windows print dialog.

If Electron cannot expose a setting reliably, defer to the native Windows print dialog rather than building a fake control.

Print selected pages via a temporary print document/window if necessary.

---

# 34. WINDOWS INTEGRATION

Required:

- `.pdf` file association option in installer;
- Open With;
- drag/drop from Explorer;
- recent files;
- jump-list support if practical;
- taskbar progress for long OCR/conversion jobs if practical;
- Windows notifications only for meaningful background completion if app is not focused;
- correct high-DPI scaling;
- touchpad scrolling;
- stylus ink support through pointer events where possible;
- Windows light/dark detection;
- Windows native file dialogs.

Do not require administrator rights for normal use.

Prefer per-user installation unless there is a reason otherwise.

---

# 35. SETTINGS

Settings categories:

## General

- theme: system/light/dark;
- startup behavior;
- reopen previous session;
- default zoom;
- default page layout;
- recent-file count;
- autosave recovery interval.

## Viewing

- smooth scrolling;
- page gap;
- background brightness in dark mode;
- text selection behavior;
- hardware acceleration toggle if needed for troubleshooting.

## Editing

- default font;
- default annotation author;
- snapping;
- guides;
- replacement-font behavior.

## OCR

- Tesseract path/status;
- tessdata path;
- installed languages;
- default language;
- default DPI.

## Conversions

- LibreOffice path/status;
- default image DPI;
- JPEG quality;
- DOCX/PPTX mode.

## Privacy

- crash logs local only;
- clear recent files;
- clear saved signatures;
- clear recovery data;
- confirm external links.

## Advanced

- qpdf path/status;
- diagnostics;
- renderer process info;
- clear caches;
- log level.

No cloud/account pane.

---

# 36. JOB SYSTEM

Long operations must not freeze the UI.

Create a job manager for:

- OCR;
- export;
- combine;
- optimize;
- compare;
- redaction application;
- conversion;
- large saves.

Job model:

- id;
- type;
- title;
- state;
- current item;
- total items;
- percentage if known;
- cancellable;
- started;
- elapsed;
- error;
- result path.

UI:

- compact progress center;
- cancel;
- retry when safe;
- open result folder;
- dismiss completed jobs.

Heavy work should happen in Web Workers, utility processes, or native sidecars, not the renderer event loop.

---

# 37. ERROR HANDLING

Create typed error categories:

- invalid PDF;
- encrypted PDF;
- wrong password;
- unsupported encryption;
- malformed content;
- write failure;
- permission denied;
- out of disk space;
- sidecar missing;
- OCR failure;
- conversion provider unavailable;
- print failure;
- cancelled operation.

User-facing errors:

- plain language;
- actionable;
- no raw stack trace by default;
- "Details" expander for diagnostics;
- copy diagnostics button.

Logs:

- local;
- rotating;
- redact passwords and sensitive text;
- do not log document content unless explicit debug mode.

---

# 38. PERFORMANCE TARGETS

These are engineering targets, not guarantees.

On a typical modern Windows machine:

- app window visible quickly after launch;
- first page of a normal PDF visible within roughly 1 second after file parsing begins when feasible;
- UI remains responsive while thumbnails render;
- scroll stays smooth for normal documents;
- 1,000-page documents do not render 1,000 full-size canvases simultaneously;
- memory is bounded by cache policies;
- OCR and conversion show progress quickly;
- opening one huge PDF does not block other tabs.

Measure with profiling before premature optimization.

---

# 39. TESTING STRATEGY

Every major subsystem requires tests.

## Unit

- coordinate conversions;
- page range parsing;
- command enable rules;
- undo/redo;
- settings validation;
- IPC schemas;
- content parser tokens/operators;
- text geometry transforms;
- OCR coordinate mapping;
- file naming;
- redaction region intersections;
- conversion option validation.

## Integration

- open/save generated PDFs;
- merge/split;
- rotate/delete pages;
- add annotation and reopen;
- form fill and reopen;
- encrypt/decrypt through qpdf;
- OCR sample and search extracted text;
- redact sample and verify text extraction cannot recover target;
- metadata edit;
- attachment add/remove;
- watermark/header/footer.

## E2E

Use Electron-capable Playwright tests:

- launch;
- open PDF;
- navigate pages;
- search;
- annotate;
- save;
- reopen;
- undo/redo;
- organize;
- OCR smoke test when binary available;
- dark/light mode;
- multi-tab;
- crash recovery smoke test if practical.

## Test fixtures

Create small deterministic PDFs in code where possible.
Do not commit copyrighted third-party PDFs as fixtures.

---

# 40. DOCUMENTATION REQUIREMENTS

Keep documentation updated as architecture lands.

Required:

- `README.md`
  - what PaperForge is;
  - screenshot placeholder only after UI exists;
  - prerequisites;
  - dev setup;
  - build;
  - tests;
  - local sidecars.
- `docs/ARCHITECTURE.md`
- `docs/EDITING_MODEL.md`
- `docs/OCR_PIPELINE.md`
- `docs/CONVERSION_PIPELINE.md`
- `docs/SECURITY.md`
- `docs/KEYBOARD_SHORTCUTS.md`
- `docs/QA_CHECKLIST.md`
- `THIRD_PARTY_NOTICES.md`

Document limitations factually.

---

# 41. FEATURES EXPLICITLY OUT OF SCOPE FOR V1

Do not spend segments implementing these unless the user expands scope:

- cloud storage sync;
- Adobe services;
- account system;
- telemetry/analytics service;
- AI chat/summarization;
- remote collaborative comments;
- remote e-signature requests;
- certificate-based digital signatures;
- trust-chain validation UI;
- scanner/TWAIN/WIA acquisition;
- 3D PDF;
- embedded multimedia playback;
- PDF portfolios as a specialized UI;
- arbitrary PDF JavaScript execution;
- advanced prepress color separations;
- professional print-production trapping;
- full standards-certified PDF/X or PDF/A remediation;
- guaranteed PDF/UA certification.

PaperForge may inspect these features safely when encountered, but should not pretend to fully author them.

---

# 42. SEGMENTED IMPLEMENTATION PLAN

The following sequence is mandatory unless a concrete technical dependency forces a small reordering.

---

## SEGMENT 0 — Repository foundation

### Goal

Create a secure, clean Electron + React + TypeScript Windows application that launches.

### Implement

- npm project;
- Electron;
- Vite;
- React;
- strict TypeScript;
- ESLint;
- Prettier;
- Vitest;
- base Electron Forge packaging;
- secure BrowserWindow;
- preload bridge;
- typed IPC foundation;
- Zod validation;
- base directory structure;
- `PROGRESS.md`;
- initial docs;
- Fluent Workspace tokens;
- basic app shell;
- light/dark/system theme;
- app icon placeholder made from simple PaperForge initials or geometry, not Adobe imagery.

### Validation

- `npm install`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run dev`
- production build/package smoke test

### Gate

Do not proceed until the packaged/dev app launches cleanly on Windows.

---

## SEGMENT 1 — Fluent Workspace shell and command system

### Goal

Build the complete reusable desktop UI skeleton before PDF logic spreads across ad-hoc components.

### Implement

- title/tab bar;
- command/menu bar;
- left rail;
- resizable left panel;
- central workspace;
- resizable right properties panel;
- status bar;
- Home screen;
- tool cards;
- recent/pinned placeholders backed by real local store;
- command registry;
- command palette;
- keyboard shortcut service;
- dialogs;
- toasts;
- progress center shell;
- theme persistence;
- responsive minimum window behavior.

### Tests

- command enable/disable;
- shortcuts;
- panel persistence;
- theme behavior.

### Gate

The shell must look polished in both themes with no document loaded.

---

## SEGMENT 2 — File service, tabs, recovery architecture

### Goal

Build safe local document session infrastructure.

### Implement

- open dialog;
- drag/drop;
- tab model;
- multiple tabs;
- dirty indicator;
- close warnings;
- recent files;
- pinned files;
- open in new window;
- safe temp workspace;
- atomic-save helper;
- recovery journal structure;
- external file-change detection;
- session restore;
- typed file IPC.

### Tests

- Unicode/spaces in paths;
- read-only paths;
- missing files;
- dirty close;
- recovery metadata.

### Gate

The app can manage file sessions safely even before full PDF viewing.

---

## SEGMENT 3 — PDF.js viewer foundation

### Goal

Open real PDFs and render them professionally.

### Implement

- PDF.js worker;
- document loader;
- password prompt;
- continuous page viewer;
- virtualized rendering;
- zoom modes;
- page navigation;
- rotations;
- selection layer;
- link layer;
- annotation layer;
- status bar;
- load/error states;
- memory-bounded page cache.

### Tests

- 1-page;
- multi-page;
- rotated page;
- encrypted sample;
- unusual page sizes.

### Gate

Viewer is stable enough for daily PDF reading.

---

## SEGMENT 4 — Navigation panels and search

### Goal

Complete reader/navigation workflow.

### Implement

- thumbnails;
- bookmarks/outline;
- attachments read-only listing;
- optional content/layers;
- text search;
- find UI;
- advanced local search options;
- link navigation;
- page labels;
- full screen/reading mode.

### Gate

Navigation/search work on normal text PDFs and degrade sensibly on scans.

---

## SEGMENT 5 — Mutation engine, save pipeline, undo/redo

### Goal

Create the reliable foundation all editing features will use.

### Implement

- `PdfMutationEngine`;
- pdf-lib integration;
- qpdf service wrapper;
- command-based undo/redo;
- transaction grouping;
- document snapshots/temp files for heavyweight transformations;
- Save/Save As/Save Copy;
- output validation;
- qpdf check where available;
- crash-safe write flow.

### Tests

- mutate/save/reopen;
- undo/redo;
- failed save leaves original intact;
- qpdf missing gracefully handled.

### Gate

No advanced editor feature may be built until safe save/undo exists.

---

## SEGMENT 6 — Comments and annotations

### Goal

Implement a complete practical annotation workflow.

### Implement

All annotation tools from Section 12 plus Comments panel and properties.

### Tests

Create -> save -> reopen -> edit/delete.
Verify annotation geometry after zoom/rotation.

### Gate

Annotations persist as PDF data where supported.

---

## SEGMENT 7 — Organize Pages

### Goal

Implement structural page operations.

### Implement

Grid, reorder, rotate, delete, duplicate, extract, split, insert, replace, blank page, image page, cross-document moves, crop foundation.

### Tests

Verify exact page counts/order after save/reopen.

### Gate

No page operation may silently alter source document before save.

---

## SEGMENT 8 — Create PDF and Combine Files

### Goal

Support new-document creation and merging.

### Implement

Blank, images, text, HTML, combine workspace, source page ranges, bookmarks-per-source option.

Add Office input adapter interface, but LibreOffice integration may land in Segment 13.

### Gate

Mixed supported local sources combine reliably.

---

## SEGMENT 9 — Edit PDF: content model and text editing

### Goal

Build the hardest core editing feature.

### Implement

- content stream parser;
- text object geometry;
- object selection;
- Tier A/B/C editing model;
- font inspection;
- edit text;
- add text;
- text properties;
- multiline boxes;
- local reflow;
- replacement font handling;
- undo/redo integration;
- save/reopen tests.

### Important

Do not rush this segment. It may require multiple user-requested continuations, but keep them recorded as subsegments in `PROGRESS.md`:

- 9A parser/model
- 9B selection geometry
- 9C native text rewriting
- 9D replacement mode
- 9E typography/reflow
- 9F regression suite

Only mark Segment 9 complete when its acceptance tests pass.

---

## SEGMENT 10 — Edit PDF: images, links, layout content

### Goal

Complete common object editing.

### Implement

- image selection;
- move/resize/rotate;
- crop;
- replace;
- export;
- flip;
- add image;
- link create/edit;
- shapes;
- watermark;
- background;
- headers/footers;
- page numbers;
- Bates numbering.

### Gate

Save/reopen preserves visual placement.

---

## SEGMENT 11 — Forms and Fill & Sign

### Goal

Cover practical form workflows and simple signatures.

### Implement

- AcroForm filling;
- field navigation;
- Prepare Form editor;
- common field types;
- validation templates;
- basic calculations without arbitrary JS;
- drawn/typed/image signatures;
- initials;
- flattening.

### Gate

Form values and signature appearances survive save/reopen.

---

## SEGMENT 12 — OCR

### Goal

Fully local OCR and searchable PDFs.

### Implement

- Tesseract service;
- binary/tessdata discovery;
- OCR UI;
- page rendering;
- progress/cancel;
- coordinate mapping;
- invisible text layer;
- local languages;
- searchable output;
- OCR diagnostics.

### Tests

Use a generated image-only PDF with known text.
After OCR, PDF.js extraction/search must find expected words.

### Gate

Zero network traffic required.

---

## SEGMENT 13 — Conversion center

### Goal

Implement local export/import workflows.

### Implement

- PDF -> images;
- PDF -> TXT;
- PDF -> HTML;
- PDF -> DOCX;
- PDF -> XLSX;
- PDF -> PPTX;
- images/TXT/HTML -> PDF;
- `LibreOfficeConversionProvider`;
- local LibreOffice detection/config;
- Office -> PDF when provider available;
- batch conversion job support.

### Gate

All conversions are honest about fidelity and provider availability.

---

## SEGMENT 14 — Protect, metadata, sanitize, attachments

### Goal

Implement document administration/security tools.

### Implement

- qpdf encryption;
- security summary;
- metadata editor;
- attachments add/remove/export;
- sanitize scanner;
- remove hidden data categories;
- document properties;
- full rewrite verification.

### Gate

Passwords never appear in logs or persisted settings.

---

## SEGMENT 15 — True redaction

### Goal

Implement reviewable, irreversible-on-save redaction correctly.

### Implement

- mark text;
- mark area;
- search-and-mark;
- reasons;
- apply;
- safe content removal;
- raster fallback for hard pages;
- sanitize option;
- save copy default;
- extraction verification.

### Gate

Automated tests must prove target text is not extractable after applied redaction.

---

## SEGMENT 16 — Compare, optimize, repair, crop

### Goal

Add high-value advanced tools.

### Implement

- compare UI;
- visual difference;
- text difference;
- synchronized views;
- compression presets;
- advanced optimizer;
- qpdf repair workflow;
- crop/page boxes;
- linearization options.

### Gate

Every destructive optimization is performed on a temporary copy before replacement.

---

## SEGMENT 17 — Accessibility and practical advanced tools

### Goal

Add remaining useful professional features without pretending to certify standards.

### Implement

- accessibility checker;
- title/language fixes;
- form-name fixes;
- alt-text editing where possible;
- image-only-page detection;
- reading-order visualization if real data supports it;
- measurement tools;
- calibration;
- layer controls polish;
- bookmarks editing.

### Gate

Accessibility wording remains factual and does not claim certification.

---

## SEGMENT 18 — Printing and Windows integration

### Goal

Make PaperForge behave like a real Windows desktop product.

### Implement

- print flow;
- page ranges;
- scale modes;
- native dialog integration;
- file associations;
- Open With;
- installer;
- high DPI;
- dark-mode integration;
- jump list if practical;
- taskbar progress if practical;
- app icon;
- protocol/path safety.

### Gate

Installer/uninstaller smoke tests pass on a clean Windows environment or documented test VM.

---

## SEGMENT 19 — Performance, polish, QA, release candidate

### Goal

Turn the feature-complete app into a releasable product.

### Implement/review

- memory profiling;
- huge PDF behavior;
- 1,000-page virtualization;
- large scanned PDFs;
- cancellation;
- crash recovery;
- keyboard-only navigation;
- high contrast;
- accessible labels;
- tooltips;
- loading states;
- empty states;
- visual consistency;
- error messages;
- logs;
- dependency licenses;
- third-party notices;
- no accidental network calls;
- no dev-only paths;
- no mocked features visible;
- auto-update remains disabled unless explicitly added later.

Run full suite:

- typecheck;
- lint;
- unit;
- integration;
- e2e;
- packaging;
- clean-install smoke test.

Create:

- `docs/RELEASE_CHECKLIST.md`
- `docs/KNOWN_LIMITATIONS.md`

### Final gate

A user should be able to install PaperForge, open common PDFs, edit/annotate/organize/OCR/convert/protect/redact them, save safely, and work completely offline.

---

# 43. DEFINITION OF DONE FOR MAJOR TOOLS

A feature is done only when:

1. User can discover it in UI.
2. It has a real implementation.
3. It participates in undo/redo when applicable.
4. It respects dirty-state tracking.
5. It saves safely.
6. Reopened output reflects the change.
7. Errors are handled.
8. Keyboard/focus behavior is reasonable.
9. Light and dark themes are correct.
10. At least one automated test covers the primary path.
11. Documentation is updated if architecture/setup changed.

---

# 44. ACCEPTANCE SCENARIOS

Before calling PaperForge v1 ready, verify these end-to-end.

## Scenario A — reader

Open a 300-page PDF, search for text, jump through results, use thumbnails/bookmarks, zoom, rotate view, print selected pages.

## Scenario B — annotate

Highlight text, draw ink, add a callout, save, close, reopen, edit one comment.

## Scenario C — organize

Open two PDFs, move pages between them, rotate two pages, delete one page, extract a range, save copies.

## Scenario D — edit

Change an existing text run in a normal digitally generated PDF, move/resize an image, add a hyperlink, add a footer, save, reopen.

## Scenario E — OCR

Open an image-only scanned PDF, OCR selected pages locally, save a searchable copy, search for known text.

## Scenario F — forms

Fill form fields, add a drawn signature and date, save, reopen, flatten a copy.

## Scenario G — redaction

Search for a test phrase, mark all occurrences, apply redaction, save as a new file, verify extraction/search cannot recover the phrase.

## Scenario H — protect

Save an encrypted copy with an open password, close it, reopen it, verify wrong password fails and correct password works.

## Scenario I — conversion

Export pages to PNG, export to DOCX, export to PPTX fidelity mode, convert images into a PDF, and use local LibreOffice to convert a DOCX to PDF when installed.

## Scenario J — failure safety

Force a failed save or kill the app during an operation. Original file remains intact and recovery is offered on restart.

---

# 45. UI COPY GUIDELINES

Use concise professional language.

Prefer:

- "Recognize Text"
- "Apply Redactions"
- "Save a Copy"
- "Protect PDF"
- "Optimize PDF"
- "Prepare Form"
- "Fill & Sign"
- "Document Properties"

Avoid:

- marketing hype;
- "AI-powered";
- fake precision;
- claims like "100% secure";
- claims like "perfect conversion";
- claims like "Adobe compatible" unless describing a specific PDF standard behavior.

When a conversion is inherently approximate, say:

- "Best for editing"
- "Best for layout fidelity"
- "Some complex layouts may change"

---

# 46. ACCESSIBILITY OF PAPERFORGE ITSELF

PaperForge's UI must support:

- keyboard navigation;
- visible focus;
- accessible names;
- logical tab order;
- no color-only status indicators;
- sufficient contrast;
- scalable UI at Windows 125/150/200%;
- screen-reader-friendly basic control structure;
- reduced-motion preference where practical.

---

# 47. PRIVACY

No telemetry.
No analytics.
No document uploads.
No remote OCR.
No remote conversion.
No remote crash reporting by default.

If the app ever needs to open a URL:

- require explicit user action;
- open in system browser;
- confirm suspicious schemes;
- never send document contents.

Settings and recent-file history remain local.

---

# 48. ENGINEERING NOTES FOR DIFFICULT PDF CASES

PDF is not a word-processing format. Preserve this distinction throughout the implementation.

Be careful with:

- Type 0/CID fonts;
- custom encodings;
- missing ToUnicode maps;
- subset fonts;
- ligatures;
- RTL text;
- vertical writing;
- transparency groups;
- clipping paths;
- nested form XObjects;
- rotated/cropped page coordinate systems;
- object streams;
- malformed xref tables;
- incremental revisions;
- annotations with appearance streams;
- AcroForm appearance generation.

For unsupported content:

- never corrupt silently;
- keep the original safe;
- expose a clear compatibility path;
- prefer a visually faithful replacement to a broken "native" rewrite;
- add the file shape to regression tests when possible.

---

# 49. PROGRESS.MD TEMPLATE

Create `PROGRESS.md` in Segment 0 using this structure:

```md
# PaperForge Progress

## Current status

- Last completed segment:
- Next segment:
- Build status:
- Test status:

## Completed segments

- [ ] 0 Repository foundation
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

## Architecture decisions

- ...

## Known limitations

- ...

## Required local tools

- qpdf:
- Tesseract:
- LibreOffice:

## Last validation

- command:
- result:

## Next-session instruction

Read CLAUDE.md and execute only the next incomplete segment.
```

Keep it current.

---

# 50. FINAL INSTRUCTION TO CLAUDE CODE

You are not building a demo. You are building a maintainable Windows desktop application.

Start with **Segment 0 only**.

Do not implement random later features early just because they are visually interesting. The sequence exists to prevent unsafe PDF mutations, untestable UI, and giant rewrites.

When a segment is complete:

- validate it;
- update documentation;
- update `PROGRESS.md`;
- commit if possible;
- stop;
- tell the user exactly what to ask for next.

The user should normally continue by saying:

`Continue PaperForge. Read CLAUDE.md and PROGRESS.md, inspect the repo, and execute only the next incomplete segment.`
