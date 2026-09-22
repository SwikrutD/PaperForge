# Third-party notices

PaperForge bundles or depends on the software listed below. Upstream copyright and license
notices are preserved; nothing here removes or supersedes them. Versions are the exact ones
pinned in `package-lock.json` at the time of writing — re-check this file whenever a dependency
is added or upgraded.

## Shipped in the application

These end up inside the packaged application.

| Package             | Version | License    | Notes                                                                                                                                          |
| ------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron            | 44.4.3  | MIT        | Includes Chromium (BSD-3-Clause and others) and Node.js (MIT). Chromium's own notices ship in `LICENSES.chromium.html` next to the executable. |
| React               | 19.3.0  | MIT        |                                                                                                                                                |
| React DOM           | 19.3.0  | MIT        |                                                                                                                                                |
| Zod                 | 4.6.5   | MIT        | IPC and settings validation                                                                                                                    |
| Zustand             | 5.0.15  | MIT        | Renderer state                                                                                                                                 |
| lucide-react        | 1.47.0  | ISC        | Generic icon set; no third-party product icons are used                                                                                        |
| pdfjs-dist (PDF.js) | 6.3.289 | Apache-2.0 | The rendering engine. Its worker, character maps, standard fonts and colour profiles are copied into the renderer bundle at build time.        |
| pdf-lib             | 1.17.1  | MIT        | The write engine, used in the main process. Brings @pdf-lib/standard-fonts (MIT), @pdf-lib/upng (MIT), pako (MIT AND Zlib) and tslib (0BSD).   |

## Development only

Not redistributed with the application.

| Package                      | Version | License    |
| ---------------------------- | ------- | ---------- |
| @electron-forge/cli          | 7.11.2  | MIT        |
| @electron-forge/maker-zip    | 7.11.2  | MIT        |
| @electron-forge/plugin-fuses | 7.11.2  | MIT        |
| @electron-forge/plugin-vite  | 7.11.2  | MIT        |
| @electron/fuses              | 1.8.0   | MIT        |
| @eslint/js                   | 10.0.1  | MIT        |
| @testing-library/jest-dom    | 7.0.1   | MIT        |
| @testing-library/react       | 16.3.3  | MIT        |
| @testing-library/user-event  | 14.6.7  | MIT        |
| @types/node                  | 26.6.2  | MIT        |
| @types/react                 | 19.3.0  | MIT        |
| @types/react-dom             | 19.3.0  | MIT        |
| @vitejs/plugin-react         | 6.1.1   | MIT        |
| eslint                       | 10.11.0 | MIT        |
| eslint-plugin-react-hooks    | 7.1.1   | MIT        |
| eslint-plugin-react-refresh  | 0.5.7   | MIT        |
| globals                      | 17.12.0 | MIT        |
| jsdom                        | 30.1.0  | MIT        |
| prettier                     | 3.9.8   | MIT        |
| ts-node                      | 10.9.2  | MIT        |
| typescript                   | 6.0.3   | Apache-2.0 |
| typescript-eslint            | 8.70.1  | MIT        |
| vite                         | 8.3.0   | MIT        |
| vitest                       | 5.0.1   | MIT        |

## Planned components

Not present in the repository yet. Listed so licensing stays visible as they are integrated.

| Component     | Expected license | Segment | Distribution intent                                                                                             |
| ------------- | ---------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| qpdf          | Apache-2.0       | 14      | Local sidecar binary, staged separately. PaperForge uses one that is already installed; nothing is bundled yet. |
| Tesseract OCR | Apache-2.0       | 12      | Local sidecar binary plus tessdata, staged separately                                                           |
| LibreOffice   | MPL-2.0 / LGPL   | 13      | Optional, never bundled; invoked only if the user already has it installed                                      |

No AGPL-licensed component is used in the core product. Ghostscript and MuPDF are deliberately
avoided for licensing reasons (see `CLAUDE.md` section 2.5).

## Fonts

PaperForge uses fonts already installed on the computer (Segoe UI Variable, Segoe UI, system-ui).
No font files are bundled or downloaded.
