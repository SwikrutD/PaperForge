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

Local Office conversion joins this list in Segment 13, as a provider whose `availability()` reports
whether a local LibreOffice was found. Nothing else about the pipeline changes when it does.

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

## Limits today

- **Office documents cannot be converted yet.** The provider interface is here and the file dialog
  offers only what really works; local LibreOffice lands in Segment 13.
- **PaperForge converts _into_ PDF here.** Exporting a PDF to images, text, Word, Excel or
  PowerPoint is the conversion centre, also Segment 13.
- **A source is converted once, when it is added.** A file changed on disk afterwards is combined as
  it was when it was added; remove it and add it again to pick up the change.
- **Text is set in Courier**, a standard PDF font, so a text file converts with no font embedding
  and no licensing question. Choosing a font is part of the text editor in Segment 9.
- **A web page converts without scripts**, deliberately.
- **Sources are held in memory** while a window has them staged, which is why a single file is
  limited to 512 MB and a window to 500 files.
