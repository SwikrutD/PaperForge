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
| docx                | 9.7.2   | MIT        | Writes the Word export. Brings jszip, nanoid, xml, xml-js and hash.js (all MIT).                                                               |
| exceljs             | 4.4.0   | MIT        | Writes the Excel export. Brings archiver, dayjs, fast-csv, readable-stream, tmp, unzipper and uuid (MIT) and saxes (ISC).                      |
| pptxgenjs           | 4.0.1   | MIT        | Writes the PowerPoint export. Brings image-size and jszip (MIT) and https (ISC).                                                               |

### A note on jszip

`jszip`, reached through both `docx` and `pptxgenjs`, is offered under **MIT OR GPL-3.0-or-later**.
PaperForge takes it under the MIT terms, which is why a GPL package appears nowhere in this file.

## Development only

Not redistributed with the application.

| Package                        | Version | License    |
| ------------------------------ | ------- | ---------- |
| @electron-forge/cli            | 7.11.2  | MIT        |
| @electron-forge/maker-squirrel | 7.11.2  | MIT        |
| @electron-forge/maker-zip      | 7.11.2  | MIT        |
| electron-winstaller            | 5.4.4   | MIT        |
| electron-builder               | 26.15.3 | MIT        |
| @electron-forge/plugin-fuses   | 7.11.2  | MIT        |
| @electron-forge/plugin-vite    | 7.11.2  | MIT        |
| @electron/fuses                | 1.8.0   | MIT        |
| @eslint/js                     | 10.0.1  | MIT        |
| @testing-library/jest-dom      | 7.0.1   | MIT        |
| @testing-library/react         | 16.3.3  | MIT        |
| @testing-library/user-event    | 14.6.7  | MIT        |
| @types/node                    | 26.6.2  | MIT        |
| @types/react                   | 19.3.0  | MIT        |
| @types/react-dom               | 19.3.0  | MIT        |
| @vitejs/plugin-react           | 6.1.1   | MIT        |
| eslint                         | 10.11.0 | MIT        |
| eslint-plugin-react-hooks      | 7.1.1   | MIT        |
| eslint-plugin-react-refresh    | 0.5.7   | MIT        |
| globals                        | 17.12.0 | MIT        |
| jsdom                          | 30.1.0  | MIT        |
| prettier                       | 3.9.8   | MIT        |
| ts-node                        | 10.9.2  | MIT        |
| typescript                     | 6.0.3   | Apache-2.0 |
| typescript-eslint              | 8.70.1  | MIT        |
| vite                           | 8.3.0   | MIT        |
| vitest                         | 5.0.1   | MIT        |

### The Windows installer

`npm run make` builds `PaperForge-Setup.exe` with electron-winstaller, which wraps the application
in Squirrel.Windows (MIT, © GitHub). The installer and the `Update.exe` it leaves beside the
installed application are Squirrel.Windows; they are redistributed with the installer, not with
the application archive. electron-winstaller's build-time tools — NuGet (Apache-2.0), 7-Zip
(LGPL-2.1 with the unRAR restriction) and rcedit (MIT) — run on the build machine only and are not
part of either distributable.

`npm run dist` builds `PaperForge-Setup-<version>-x64.exe`, the setup wizard, with
electron-builder (MIT). electron-builder only wraps the folder Forge packaged; it fetches NSIS
(zlib/libpng license, with bzip2 and zlib parts under their own permissive licenses) and 7-Zip
onto the build machine the first time it runs. The NSIS installer and uninstaller stubs are
redistributed inside the setup program and the installed folder (`Uninstall PaperForge.exe`); NSIS's
license permits that without notice requirements. 7-Zip runs on the build machine only.

### Licenses other than MIT, ISC, Apache-2.0 and BSD

`npm run licenses` audits every package that ships, from `package-lock.json`. Besides the
common permissive licenses it finds:

| Package            | Version      | License           | Reached through             | Notes                                                                                                                                                             |
| ------------------ | ------------ | ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| jszip              | 3.10.2       | MIT OR GPL        | docx, pptxgenjs, exceljs    | Taken under MIT (see above)                                                                                                                                       |
| pako               | 1.0.11       | MIT AND Zlib      | pdf-lib, jszip              | Both permissive                                                                                                                                                   |
| sax                | 1.6.1        | BlueOak-1.0.0     | docx > xml-js               | Permissive                                                                                                                                                        |
| big-integer        | 1.6.52       | Unlicense         | exceljs > unzipper          | Public-domain dedication                                                                                                                                          |
| chainsaw, traverse | 0.1.0, 0.3.9 | MIT/X11           | exceljs > unzipper > binary | The MIT licence                                                                                                                                                   |
| buffers            | 0.1.1        | **none declared** | exceljs > unzipper > binary | The package states no license and its upstream repository is gone. Flagged by the audit as needing review before redistribution; see `docs/RELEASE_CHECKLIST.md`. |

## Local tools PaperForge can use

None of these is bundled. PaperForge finds a copy that is already installed (or one the user
points it at in Settings) and runs it as a separate program; nothing is downloaded.

| Component     | License        | Used for                                                    |
| ------------- | -------------- | ----------------------------------------------------------- |
| qpdf          | Apache-2.0     | Protect PDF; checking saved files; stronger repair; packing |
| Tesseract OCR | Apache-2.0     | Recognize Text (with the user's tessdata)                   |
| LibreOffice   | MPL-2.0 / LGPL | Office documents to PDF, optional                           |

If a later build bundles qpdf or Tesseract, their notices must be added to the package and to this
file. No AGPL-licensed component is used in the core product. Ghostscript and MuPDF are
deliberately avoided for licensing reasons (see `CLAUDE.md` section 2.5).

## Fonts

PaperForge uses fonts already installed on the computer (Segoe UI Variable, Segoe UI, system-ui).
No font files are bundled or downloaded.
