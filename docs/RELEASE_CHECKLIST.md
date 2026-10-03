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
npm run make
```

- [ ] Every command passes. `npm run test:e2e` packages the application and drives it, including
      the `recovery`, `offline`, `largeDocuments` and `keyboardAndContrast` suites; note the
      first-page time and memory figures `largeDocuments` prints, and compare them with the last
      release.
- [ ] `npm run licenses` passes and lists nothing under "Reviewed" that has not been decided (see
      section 6).

## 3. The packaged application

- [ ] `out/PaperForge-win32-x64/PaperForge.exe` starts, opens a PDF and closes cleanly.
- [ ] Nothing in the window says "not built", "coming soon" or similar, and every home-screen tool
      card opens a working tool.
- [ ] Developer tools cannot be opened (`Ctrl+Shift+I` does nothing).
- [ ] `%APPDATA%/PaperForge/logs/paperforge.log` holds no document text and no password after a
      session that opened a protected document and protected another.

## 4. Clean-machine install

On a clean Windows 11 x64 VM, signed in as a standard user, with no network:

- [ ] `PaperForge-Setup.exe` installs without an administrator prompt and opens PaperForge.
- [ ] Start menu and desktop shortcuts exist; PaperForge appears under Open With for `.pdf` and in
      Settings → Apps → Default apps.
- [ ] Choose PaperForge as the default PDF app in Windows Settings; double-clicking a PDF with a
      Unicode name and spaces in its path opens it; a second double-click opens the next file in the
      running window.
- [ ] Display scaling at 100, 125, 150 and 200 %: the shell and the pages are sharp and nothing is
      clipped.
- [ ] Light, dark and a high-contrast theme all look correct.
- [ ] Uninstall from Settings → Apps: shortcuts, the Open With entry and the Apps entry are gone,
      and another PDF reader's association is untouched.

## 5. Acceptance scenarios

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

## 6. Licences and notices

- [ ] `THIRD_PARTY_NOTICES.md` matches `npm run licenses`, and its versions match
      `package-lock.json`.
- [ ] **Open item: `buffers` 0.1.1** (exceljs → unzipper → binary) declares no license, and its
      upstream repository no longer exists. Before redistributing PaperForge outside the
      development team, either get a legal review that accepts it, or remove the dependency path —
      for example by writing the Excel export without exceljs. Record the decision in
      `scripts/check-licenses.mjs` and `THIRD_PARTY_NOTICES.md`.
- [ ] If qpdf or Tesseract has been bundled for this build, their licenses and notices ship with it.
- [ ] Chromium's `LICENSES.chromium.html` is next to the executable in the installed folder.

## 7. Publishing

- [ ] The installer and zip are built from the commit tagged in step 1, and their SHA-256 hashes are
      recorded with the release.
- [ ] Release notes list what changed, and link `docs/KNOWN_LIMITATIONS.md`.
- [ ] Auto-update is still off: PaperForge never calls the updater, and the release notes say how to
      install a newer version over this one.
