# Dependencies

Every dependency is pinned to an exact version (`.npmrc` sets `save-exact=true`) and recorded in
`package-lock.json`. Licenses are listed in `THIRD_PARTY_NOTICES.md`; this file explains **why**
each one is here and what would have to happen to remove it.

## Runtime

| Package          | Why                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| react, react-dom | UI framework for the renderer. Chosen in `CLAUDE.md` section 2.2.                                                                                                                                                                                                              |
| zod              | Runtime validation at the IPC boundary and for persisted settings. Shared by main and renderer, so a schema is written once and enforced on both sides.                                                                                                                        |
| zustand          | Small, unopinionated renderer state container. Used for the app store today, workspace and tab state later.                                                                                                                                                                    |
| lucide-react     | Generic icon set (ISC). Deliberately generic — no product-specific or third-party branded icons.                                                                                                                                                                               |
| pdfjs-dist       | The PDF rendering engine (Apache-2.0), used behind the engine contract in `src/pdf/render`. Its worker, character maps, standard fonts and colour profiles ship with the application.                                                                                          |
| pdf-lib          | The PDF write engine (MIT), used behind `PdfMutationEngine` in `src/pdf/mutate` and only from the main process. Pure JavaScript, so it needs no native build; it rewrites a whole file rather than appending an incremental update, which is what makes a revision a snapshot. |

Electron itself is a development dependency that becomes the runtime: Forge packages it into the
application.

## Development

| Package                                                                                                | Why                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| electron                                                                                               | Desktop shell.                                                                                                                    |
| @electron-forge/cli, plugin-vite, maker-zip                                                            | Build, dev-run and packaging pipeline.                                                                                            |
| @electron-forge/plugin-fuses, @electron/fuses                                                          | Flips Electron security fuses at package time. Pinned to `@electron/fuses@1.x` because the Forge plugin peer-requires that major. |
| ts-node                                                                                                | Lets Forge load `forge.config.ts` as TypeScript.                                                                                  |
| vite, @vitejs/plugin-react                                                                             | Bundling and dev server for all three targets.                                                                                    |
| typescript                                                                                             | Strict type checking across four projects.                                                                                        |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals | Type-aware linting, including the rules that keep Node APIs out of the renderer.                                                  |
| prettier                                                                                               | Formatting. `CLAUDE.md` is excluded so the specification is never reformatted.                                                    |
| vitest, jsdom, @testing-library/{react,jest-dom,user-event}                                            | Unit and component tests.                                                                                                         |
| @types/node, @types/react, @types/react-dom                                                            | Type definitions.                                                                                                                 |

## Version choices worth knowing

- **TypeScript 6.0.3** rather than 7.x: `typescript-eslint@8` peer-requires `<6.1.0`, so the
  type-aware lint rules would be unavailable on 7. Revisit when typescript-eslint supports it.
- **Preload is CommonJS**, so `package.json` has no `"type": "module"`. Sandboxed preload scripts
  cannot be ES modules; making the package ESM would force a mixed-format build for no gain.
- **Vite config files use the `.mts` extension** so they may use `import.meta` while
  `forge.config.ts` is still loaded as CommonJS by ts-node.
- **End-to-end tests run the build unpackaged.** The packaged application has the Node inspector
  fuse disabled, which is precisely what stops a test runner from attaching to it. Playwright
  therefore launches `.vite/build/main.js` with the Electron binary: same code, same `app://`
  renderer, without the fuses. The packaged build is smoke-tested separately.
- **No Squirrel maker yet.** `@electron-forge/maker-squirrel` pulls in `electron-winstaller` and a
  large, partly outdated dependency tree; the installer is a Segment 18 deliverable, so it is added
  there rather than carried unused.
- **Fluent UI React Components is not installed yet.** Segment 0 needs tokens, not a control
  library. The decision for or against it belongs to Segment 1, where the real shell controls are
  built; the design tokens are deliberately framework-neutral either way.

## Adding a dependency

1. Check the license. MIT, ISC, BSD and Apache-2.0 are fine. AGPL and GPL are not acceptable in the
   core product; LGPL/MPL components are acceptable only as optional, separately installed local
   tools (see LibreOffice in `THIRD_PARTY_NOTICES.md`).
2. Install with the exact version (the `.npmrc` default).
3. Add it to `THIRD_PARTY_NOTICES.md` and to the table above with a one-line justification.
4. Prefer no dependency at all for something small and stable — the icon generator and the atomic
   write helper are deliberately hand-written for that reason.

## Known advisories

`npm audit --omit=dev` reports **0 vulnerabilities**: the runtime dependency set is intentionally
tiny. The full audit reports findings in the Electron Forge packaging chain only — `tar` and
`extract-zip`, reached through `@electron/get` and `@electron/packager`. Those run on the developer
machine during download and packaging and are not shipped in the application. They are re-checked
whenever Forge is upgraded; `npm audit fix --force` is not run, because it would downgrade Forge.

## Local programs PaperForge can use

Neither is bundled and neither is downloaded; PaperForge finds what is installed and says plainly
when it is not there.

| Program   | Licence    | What it is for                                                |
| --------- | ---------- | ------------------------------------------------------------- |
| qpdf      | Apache-2.0 | A second opinion on a file PaperForge has just written        |
| Tesseract | Apache-2.0 | Reading the words on a scanned page, with local language data |
