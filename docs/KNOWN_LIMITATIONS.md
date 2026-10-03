# Known limitations

What PaperForge 0.1.0 does not do, or does only partly, as of the Segment 19 release candidate.
Each entry is a fact about the current build, not a plan. `CLAUDE.md` is the specification;
where this list and the specification differ, this list describes what was actually built.

PDF is a fixed-layout format. Several entries below follow from that rather than from PaperForge,
and are worded so.

## Viewing

- **Continuous scrolling only.** Single page, two-page spread and cover-page layouts, the hand
  (pan) tool, marquee zoom and presentation mode from `CLAUDE.md` section 10 are not built. Full
  screen (`F11`) and reading mode (`Ctrl+Shift+R`) are.
- A jump of more than two screens goes straight to the page rather than gliding; nearer jumps glide
  unless Windows asks for reduced motion.
- Changing a layer's visibility applies to the view; Save as default writes it into the document.
  Layers locked by the document are not shown as locked, and per-layer print or export settings are
  not edited.
- Thumbnails in the navigation panel are list items for every page (only those near the view are
  drawn). Documents of many thousands of pages have not been measured.
- Tooltips use the native `title` attribute.

## Search

- Search covers page text. Bookmarks and annotation text are not searched, and there are no regular
  expressions: punctuation searches for itself.
- A search stops collecting at 5,000 matches and says so.
- Highlights are placed from text-run geometry, so on a run with unusual per-glyph spacing a
  highlight can be a fraction of a character out. What is found is unaffected.
- A scanned page has no text to search until Recognize Text has been run on it.

## Saving, history and recovery

- Every change rewrites the whole document (pdf-lib). PaperForge does not claim byte-level
  incremental saving; its "incremental" is the recovery journal and revision history.
- The undo history keeps at most 30 revisions or 512 MB per document, trimmed from the oldest end.
  The main process reports when that has happened, but the window does not yet say so.
- After a crash, unsaved changes come back as one step ("Recovered unsaved changes"): the undo
  history from before the crash is not restored, only its result.
- File watching uses `fs.watch`, which reports a change but not who made it; a file replaced by a
  rename is reported as modified.
- Tabs reorder by dragging or the context menu; there is no keyboard chord for it.

## Comments

- A comment can be moved but not resized by handle; text markup and ink are deliberately not
  resizable.
- Text in a text box, callout or stamp is drawn in Helvetica. The comment keeps whatever was typed
  in full Unicode; the drawn appearance shows a question mark for a character Helvetica cannot
  draw.
- XFDF import and export are not implemented. File attachment annotations are read and listed, but
  PaperForge adds attachments to the document, not as annotations.
- Measurements use one rectilinear scale per document while it is open; a page's own viewport
  measure dictionaries (`/VP`) and `/UserUnit` are not read. Angle, radius and geographic measures
  are not offered. A measurement's scale is fixed when it is made.

## Editing text, images and page furniture

- Text editing rewrites a run in its own font where that is safe, and otherwise replaces it with
  text drawn in a standard font, after asking. The standard fonts cover Latin-1: Cyrillic, Greek
  and CJK cannot be written, because embedding a system font (`CLAUDE.md` section 13.4) is not
  built.
- Reflow is not attempted: a run keeps its position, and changing its length moves what follows it
  only as far as the stream's own positioning does.
- Text and images inside a form XObject are not listed by the editor, which reads the page's own
  content stream. The toolbar says when it finds nothing it can edit on a page.
- A CMYK image cannot be exported as such: a JPEG comes out untouched and everything else is written
  as a PNG of its samples, which an indexed or ICC image will have in its own space.
- Links point at a page, or at an `http`, `https` or `mailto` address. Named destinations, launch
  actions and document JavaScript are described where found but cannot be authored, and are never
  followed. A link's rectangle is axis-aligned.
- Watermarks sit in the middle of the page. There is no listing of which pages carry PaperForge's
  watermarks, headers or footers; Remove takes off whatever PaperForge put on the pages chosen.

## Pages, creation and combining

- Bookmarks are not rewritten when pages are deleted: a bookmark whose page is deleted points at
  nothing. Reordering keeps them, because a destination points at the page object.
- Extracted and split documents carry the pages, title and author — not the outline, attachments
  or form.
- Inserting from another PDF in the page grid takes all of it; choosing pages is what Combine does.
- Combine converts a staged file once, when it is added; a file changed afterwards is combined as it
  was. One staged file is limited to 512 MB and one window to 500 files.
- Text files are set in Courier. Web pages are converted without running their scripts.
- Office documents need a local LibreOffice; without one they are refused with a reason.

## Forms and signatures

- Simple signatures are visual marks. Certificate-based signing and its validation are out of scope
  for v1, and the interface says so.
- No document JavaScript is run. A form that calculates with a script keeps the script, unrun;
  PaperForge's own calculations are sum, product and average.
- A radio group's options are fixed when the field is made. A new field takes pdf-lib's border and
  fill colours. XFA forms are not supported (the AcroForm underneath is used).

## Recognize Text

- Recognised words are written with the standard fonts, which cover Latin-1: other scripts are
  recognised but searchable only as far as that encoding reaches.
- No deskew or despeckle; the optional cleanup is greyscale and contrast. Every recognised word is
  written, whatever its confidence; the dialog reports the overall confidence.

## Conversion

- Word export writes paragraphs, headings and tab-separated table rows — not real Word tables,
  columns, or headers and footers. Excel export writes what looks like a table; there are no
  formulas. PowerPoint's editable mode places text boxes where the words sat. A web page export is
  a picture of each page with its words over it, not a reflowing page. Each says so in the dialog.

## Protect, properties and hidden information

- Protect PDF needs qpdf. Encrypting passes the new passwords to qpdf on its command line, the only
  way qpdf accepts them; another program on the same machine could read them from the process list
  while qpdf runs. The password for removing security goes on standard input. Neither is logged.
- PDF permissions are cooperative: other software may ignore them. The finer permission bits are
  reported but not offered separately; 40-bit RC4 folds the choices into its four bits.
- Whether a password is needed to open is worked out for the standard security handler revisions 2
  to 6; other handlers are reported as unknown.
- Fonts are listed from the pages' own resources, not from inside form XObjects.
- Hidden layers are removed by taking them out of the catalogue's listing; their content stays on
  the page, no longer optional. XMP metadata is removed whole or left alone.

## Redaction

- Marks are renderer state until applied, and are lost if the document closes first. Applied
  redactions are an undoable edit until saved; the default is to save as a new file.
- Content the engine cannot cut safely — text in a font without widths, a partly covered group,
  inline images, JPEG or masked pictures only partly covered — turns that page into a picture
  (200 dpi) with the marks painted on. Its text is then not selectable until recognised again.
  The review dialog lists such pages and why.
- A path crossing a mark's edge is painted over, not cut. Shadings and patterns are not cut.
- Redaction does not change bookmark titles or the descriptions in a tag tree. Find text to mark
  does not search inside groups or scans. A widget under a mark removes its whole field.

## Compare, optimize, repair, crop

- Compare pairs pages by position plus one offset and compares words in PDF.js's order, so a
  reflowed paragraph reads as changed text. Pages are compared at up to 1,400 pixels on the long
  side. A document that needs a password to open cannot be compared.
- Optimize does not subset, merge or remove fonts, or merge duplicate objects. CMYK, indexed, Lab,
  JBIG2 and JPEG 2000 pictures are left as they are. A grey picture re-encoded as JPEG is written as
  colour. Optimizing runs in the main process; on a very large document the window waits.
- A repaired copy is made from the revision shown; qpdf cannot repair a document that needs a
  password to open.
- The crop frame is drawn on one page at a time; bleed, trim and art boxes are shown, not edited.

## Accessibility Check

- The check reads structure; it does not certify anything, add or repair tags, edit reading order or
  judge colour contrast. Alternate text is offered for `Figure` and `Formula` elements only.
  "Text outside the tags" and image-only pages are judged on the page's own content, not inside
  groups.

## Printing and Windows

- Printing sends pictures of the pages (150 or 300 dpi), not vector content. Trays, duplex and
  finishing are left to the Windows print dialog; whether a silent job honours colour, copies and
  collation is up to the driver. Printing has been checked through Chromium's PDF output, not yet on
  a physical printer.
- Windows does not let an app make itself the default PDF handler; PaperForge offers itself in Open
  With and Default apps. Uninstalling leaves Squirrel's `Update.exe` and a `.dead` folder that
  Squirrel removes on its next run.
- The jump list, AppUserModelID and file association are set by installed copies only. Notifications
  need the installer's Start menu shortcut.
- No auto-update, and no arm64 build.

## Local tools

- qpdf, Tesseract and LibreOffice are not bundled; each is found where it is installed or pointed
  at in Settings. `resources/bundled-tools` and `resources/tessdata` are empty.

## Licensing

- `buffers` 0.1.1, reached through exceljs → unzipper → binary, declares no license and its
  upstream repository is gone. `npm run licenses` records it as needing review before PaperForge
  is redistributed. See `docs/RELEASE_CHECKLIST.md`.
