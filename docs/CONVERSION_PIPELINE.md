# Conversion pipeline

How a file that is not a PDF becomes one, and how several documents become a single one.

## One interface for every way in

`src/conversion/models/provider.ts` defines what a way in is:

```ts
interface ConversionProvider {
  id: string;
  label: string; // what a file dialog calls it
  extensions: readonly string[];
  availability(): Promise<string | null>; // null when it can run
  toPdf(input: SourceInput, setup: PageSetup): Promise<Uint8Array>;
}
```

`availability()` is the honest part: a provider that needs a local component it cannot find says so
in words the reader can act on, and the file is refused with that reason rather than silently
producing nothing. Nothing is ever downloaded to make a provider available.

The providers a running PaperForge has:

| Provider | Extensions              | Made of                                     |
| -------- | ----------------------- | ------------------------------------------- |
| `pdf`    | pdf                     | the file itself, checked before it is used  |
| `image`  | png, jpg, jpeg          | one page per image, `@pdf/create/documents` |
| `text`   | txt, text, log, md, csv | text set in Courier, wrapped to the page    |
| `html`   | html, htm               | Chromium's own printing (main process)      |

| `libreoffice` | doc, docx, odt, rtf, xls, xlsx, ods, ppt, pptx, odp | a local LibreOffice, run headlessly |

The LibreOffice provider is the honest part made visible: it says whether it can run, and when it
cannot, an Office file is refused with a reason that also says nothing would have been uploaded
either way. When it can, LibreOffice is asked to convert into a folder of PaperForge's own, with a
user profile of its own so a copy the reader has open keeps working and their settings are
untouched. What comes back is what LibreOffice produced — PaperForge claims no fidelity of its own
over it.

## Staging, not uploading

A file chosen in the native picker is read by `SourceLibrary` (main process), converted by its
provider, and kept as PDF bytes belonging to the window that added it. The renderer is handed a
list of names, kinds and page counts — never a path and never the bytes. It previews a source over
the document protocol (`pfdoc://source/<id>`), the same way it reads an open document, so the first
page can be drawn without the file ever crossing IPC.

Changing the paper size converts the staged files again: for a file that has already become pages,
that is the only thing changing the paper can mean. A PDF is left exactly as it was.

A window's sources go when the window closes, and combining clears them.

## Web pages

An HTML file is as untrusted as a PDF, so it is printed in a window that can reach nothing:

- its own empty session, with every request that is not the local file refused;
- `javascript: false`, `sandbox: true`, `contextIsolation: true`, no node;
- a load timeout, after which the window is destroyed and the file reported as unconvertible.

The result is whatever Chromium prints, on the paper and margins the reader chose. Because scripts
do not run, a page that builds itself with JavaScript converts as the markup it shipped with.

## Combining

`@pdf/create/combine` copies the pages of each source into a new document, in the order the reader
arranged them, taking the page range each source was given and adding its rotation. No source is
opened for writing.

Bookmarks can come along:

- **One for each file** adds a top-level entry named after the file, pointing at its first page.
- **Keep the bookmarks the files already have** reads each source's outline as page indices,
  translates them to where those pages landed, and writes them again. An entry whose page was not
  taken is dropped and its children take its place, so a section's bookmarks survive their heading.

With both on, the carried entries nest under the file they came from.

`src/pdf/create/outline.ts` does the reading and writing, because pdf-lib has no outline API. It
resolves destinations written directly, through a `/GoTo` action, and through either place a PDF
keeps named destinations (`/Dests` and the `/Names /Dests` name tree).

## Publishing the result

Every new document goes through `publishDocument`: a temporary sibling file, flushed, reopened
through the mutation engine — and inspected by qpdf when it is installed — before it replaces
anything. The same rule as a save, and the same one extraction and splitting follow.

The reader chooses where it goes in a native save dialog, and PaperForge opens what it wrote.

## Exporting: out of PDF again

Export is the other direction, and it runs the same way OCR does: the window draws and reads a page
at a time, because that is where PDF.js is, and the main process writes the files. Only one page is
ever in flight, so a three-hundred-page document costs no more memory than a one-page one.

| Mode          | What it carries                                                          |
| ------------- | ------------------------------------------------------------------------ |
| PNG/JPEG/WebP | The page exactly as it looks, and none of its words                      |
| Text          | The words, and nothing else — optionally spaced as the page spaces them  |
| Web page      | The words where they sit, over a picture of each page, in a local folder |
| Word          | Paragraphs and headings, read from the geometry                          |
| Excel         | Rows and columns where PaperForge can see them, a sheet to a page        |
| PowerPoint    | A slide a page: the page as a picture, or its words as text boxes        |

An export never touches the document. The reader chooses the destination first — a folder for
pictures, a file for anything else — so a dismissed dialog costs nothing, and a stopped run keeps
the pictures it had already written.

### Reading the geometry

There are no paragraphs in a PDF and no tables: `src/conversion/analysis/layout.ts` reads them out
of where the words sit.

- **Lines** are the pieces of text that share a baseline, within half the text's own height, so a
  superscript stays on its line. A gap wider than a fifth of the text's height becomes a space.
- **Paragraphs** break where the gap between lines grows past one and a half lines, where the left
  edge steps in or out, or where the text changes size. A block set noticeably larger than the
  page's usual text, and no more than three lines long, is called a heading.
- **Tables** are found only where most candidate lines break at the same places across the page,
  and never from fewer than three rows. A page of prose returns nothing, deliberately: a wrong
  table is worse than no table.

Every one of those readings can be wrong, which is why each mode says what it carries before the
reader picks it, and why the Word and Excel exports say that complex layouts will change.

### Honest about text

An export of the words is worth nothing on a scan nobody has read, so the dialog looks at the first
few pages and offers Recognize Text when it finds none. Exporting pictures of the pages says
nothing, because that carries the scan itself.

## Limits today

- **A picture export carries no words, and a word export carries no pictures except where it says
  so.** That is the trade the format makes, not a limitation PaperForge hides.
- **Word export writes paragraphs, headings and tab-separated table rows.** It does not write real
  Word tables, columns, headers and footers, or styles beyond a heading level.
- **Excel export writes what looks like a table, and a line a row where nothing does.** It writes
  no formulas: PaperForge will not invent one from a total it has only read.
- **PowerPoint's editable mode places text boxes where the words sat.** Complex layouts change, and
  it says so.
- **A web page is a page picture with the words over it.** It is not a reflowing HTML rendering of
  the document.
- **A source is converted once, when it is added.** A file changed on disk afterwards is combined as
  it was when it was added; remove it and add it again to pick up the change.
- **Text is set in Courier**, a standard PDF font, so a text file converts with no font embedding
  and no licensing question. Choosing a font is part of the text editor in Segment 9.
- **A web page converts without scripts**, deliberately.
- **Sources are held in memory** while a window has them staged, which is why a single file is
  limited to 512 MB and a window to 500 files.
