# Release checklist

Walk this list for every build that leaves the development machine. Tick a box only when the step
was actually done for this build; a step that cannot be done is a reason not to release, or a line
in the release notes saying why.

## 1. Source

- [ ] `git status` is clean and the build is made from a tagged commit.
- [ ] `version` in `package.json` is the version being released (Squirrel and the Apps & features
      entry read it).
- [ ] `PROGRESS.md`, `docs/KNOWN_LIMITATIONS.md` and `README.md` describe this build.

## 2. Automated gates

Run on Windows x64 from a clean clone (`git clean -xfd` keeps nothing from an earlier build):

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run licenses
npm run test:e2e
npm run dist
```

- [ ] Every command passes. `npm run test:e2e` packages the application and drives it, including
      the `recovery`, `offline`, `largeDocuments` and `keyboardAndContrast` suites; note the
      first-page time and memory figures `largeDocuments` prints, and compare them with the last
      release.
- [ ] `npm run licenses` passes and lists nothing under "Reviewed" that has not been decided (see
      section 7).

## 3. Building the setup wizard

`npm run dist` is the one command that produces what you give people. It:

1. builds and packages the app with Electron Forge into `out/PaperForge-win32-x64/` (Electron, the
   app and everything it needs — the person installing needs no Node.js or npm);
2. wraps that folder in an NSIS setup wizard with electron-builder (`electron-builder.yml`, with
   PaperForge's own page and registry work in `resources/installer/installer.nsh`).

The result is **`out/installer/PaperForge-Setup-<version>-x64.exe`** — a single file of about
100 MB, and the only thing to hand out. The first `npm run dist` on a machine downloads NSIS and
7-Zip into electron-builder's cache (`%LOCALAPPDATA%\electron-builder\Cache`); later builds work
offline. The installed app itself never goes online.

The wizard, in order:

1. **License Agreement** — PaperForge's MIT license; the reader clicks I Agree.
2. **Choose Install Location** — defaults to `%LOCALAPPDATA%\Programs\PaperForge`, with Browse.
   Always a per-user install, so there is no administrator prompt.
3. **Additional tasks** — _Create a desktop shortcut_ and _Open PDF files with PaperForge_, both
   ticked by default. The second adds PaperForge to Open with and to Settings → Default apps. It
   writes exactly the keys Settings → Windows inside the app writes, so either can undo the other.
   Windows does not let an installer make itself the default PDF app; the page tells the reader how
   to choose it.
4. **Install**, then **Finish** with _Run PaperForge_ ticked.

A Start menu shortcut is always made. The uninstaller is `Uninstall PaperForge.exe` in the install
folder and is listed in Settings → Apps → Installed apps. It removes the program, the shortcuts and
the PDF association, and leaves the reader's settings, signatures and recent files in
`%APPDATA%\PaperForge`, which a later install picks up again.

Silent install and uninstall, for scripted testing (a silent install takes both Additional-tasks
options; `/D=` must come last and is not quoted):

```bat
PaperForge-Setup-0.1.0-x64.exe /S /D=C:\Some Folder\PaperForge
"%LOCALAPPDATA%\Programs\PaperForge\Uninstall PaperForge.exe" /S /currentuser
```

**Optional tools.** qpdf (Protect PDF, checking saved files) and Tesseract (Recognize Text) are not
part of PaperForge and are not downloaded. A copy staged before `npm run dist` in
`resources/bundled-tools/qpdf/` (`qpdf.exe` there or in `bin/`) or
`resources/bundled-tools/tesseract/` (`tesseract.exe` with its `tessdata` folder) ships inside the
installer and is used ahead of any installed copy. Without them PaperForge installs and runs, and
those two features say the tool is missing. Before bundling either, review its license and those of
the DLLs it brings — the common Windows Tesseract build includes LGPL libraries such as GLib, Pango
and Cairo — and add them to `THIRD_PARTY_NOTICES.md`.

- [ ] `npm run dist` finishes and `out/installer/PaperForge-Setup-<version>-x64.exe` exists.
- [ ] Install through the wizard (not silently): the pages above appear, the chosen folder is used,
      an unticked desktop shortcut is not made, and Finish starts PaperForge.
- [ ] Explorer → right-click a PDF → Open with → PaperForge opens it in a tab.
- [ ] Uninstall from Settings → Apps: the install folder, the shortcuts, the Open with entry and the
      Apps entry are gone, and another PDF reader's Open with entry is untouched.

`npm run make` still builds the older one-click Squirrel installer
(`out/make/squirrel.windows/x64/PaperForge-Setup.exe`) and a zip of the unpacked app
(`out/make/zip/`). The zip is a portable copy — unzip it and run `PaperForge.exe` — with no
shortcuts and no association. Do not hand out the Squirrel installer alongside the wizard: they
install to different folders and both register PaperForge for PDF files.

## 4. The packaged application

- [ ] `out/PaperForge-win32-x64/PaperForge.exe` starts, opens a PDF and closes cleanly.
- [ ] Nothing in the window says "not built", "coming soon" or similar, and every home-screen tool
      card opens a working tool.
- [ ] Developer tools cannot be opened (`Ctrl+Shift+I` does nothing).
- [ ] `%APPDATA%/PaperForge/logs/paperforge.log` holds no document text and no password after a
      session that opened a protected document and protected another.

## 5. Clean-machine install

On a clean Windows 11 x64 VM, signed in as a standard user, with no network:

- [ ] `PaperForge-Setup-<version>-x64.exe` installs without an administrator prompt and opens
      PaperForge at Finish.
- [ ] The Start menu shortcut exists, and the desktop shortcut exactly when it was ticked; PaperForge appears under Open With for `.pdf` and in
      Settings → Apps → Default apps.
- [ ] Choose PaperForge as the default PDF app in Windows Settings; double-clicking a PDF with a
      Unicode name and spaces in its path opens it; a second double-click opens the next file in the
      running window.
- [ ] Display scaling at 100, 125, 150 and 200 %: the shell and the pages are sharp and nothing is
      clipped.
- [ ] Light, dark and a high-contrast theme all look correct.
- [ ] Uninstall from Settings → Apps: shortcuts, the Open With entry and the Apps entry are gone,
      and another PDF reader's association is untouched.

## 6. Acceptance scenarios

Walk scenarios A to J of `CLAUDE.md` section 44 on the installed copy, with the network
disconnected, using real documents rather than generated ones: a long report, a scanned book, a
Word export, a fillable form. The manual sections of `docs/QA_CHECKLIST.md` say what to look for,
in particular the sections still marked as not yet verified in `PROGRESS.md`:

- [ ] Printing on a physical printer and on Microsoft Print to PDF (Segment 18).
- [ ] Protect PDF with a real qpdf: encrypt, reopen with the wrong and the right password, remove
      security (Segment 14).
- [ ] Redaction, Compare and Optimize on third-party documents (Segments 15 and 16).
- [ ] The Accessibility Check with a tagged Word export and a screen reader, and measurement on a
      real scaled drawing (Segment 17).
- [ ] Crash recovery (Scenario J): end PaperForge from Task Manager with unsaved changes, restart,
      reopen, and save.

## 7. Licences and notices

- [ ] `THIRD_PARTY_NOTICES.md` matches `npm run licenses`, and its versions match
      `package-lock.json`.
- [ ] **Open item: `buffers` 0.1.1** (exceljs → unzipper → binary) declares no license, and its
      upstream repository no longer exists. Before redistributing PaperForge outside the
      development team, either get a legal review that accepts it, or remove the dependency path —
      for example by writing the Excel export without exceljs. Record the decision in
      `scripts/check-licenses.mjs` and `THIRD_PARTY_NOTICES.md`.
- [ ] If qpdf or Tesseract has been bundled for this build, their licenses and notices ship with it.
- [ ] Chromium's `LICENSES.chromium.html` is next to the executable in the installed folder.

## 8. Publishing

- [ ] The setup wizard is built from the commit tagged in step 1, and its SHA-256 hash is
      recorded with the release.
- [ ] Release notes list what changed, and link `docs/KNOWN_LIMITATIONS.md`.
- [ ] Auto-update is still off: PaperForge never calls the updater, and the release notes say how to
      install a newer version over this one.
