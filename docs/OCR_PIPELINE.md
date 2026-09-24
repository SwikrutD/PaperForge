# Recognising text

How PaperForge turns a scan into a document whose words can be found — on this computer, with
nothing uploaded and nothing downloaded.

## What runs where

| Step                                 | Where                                                   |
| ------------------------------------ | ------------------------------------------------------- |
| Rendering the page as a picture      | The window, with PDF.js, onto a canvas it then discards |
| Cleaning the picture up (when asked) | The window, on the same canvas                          |
| Reading the words                    | The main process, running the local Tesseract binary    |
| Putting the words on the page        | The mutation engine, as an ordinary undoable change     |

The window renders because that is where PDF.js is; the main process runs the binary because that
is the only place allowed to run anything at all (`docs/SECURITY.md`). The picture crosses between
them as base64 in a schema-validated payload, one page at a time, and is never written anywhere
except a file of PaperForge's own under the system temporary folder, which is deleted as soon as
Tesseract has read it.

## The pipeline

1. **Render** the page at the chosen resolution — 300 dots an inch by default, which is what a
   scanner produces and what Tesseract expects. A page that would come to more than forty million
   pixels is refused with a suggestion to choose a lower resolution rather than being attempted.
2. **Clean up**, if the reader asked: the picture is flattened to grey and its contrast lifted with
   a gentle curve. This helps a photographed page and rarely harms a clean scan. The document is
   not touched — this is the picture being read, not the page being edited.
3. **Read**: `tesseract <image> - -l <languages> --dpi <dpi> [--psm 1] tsv`, with no shell, an
   argument array, and a child process that a cancelled run kills. `--psm 1` asks Tesseract to work
   out which way up the page is; it is passed only when the orientation data (`osd`) is installed,
   because asking for it otherwise would only fail.
4. **Parse** the TSV: one row per word, with the box it was read from, the line it belongs to, and
   how sure Tesseract was.
5. **Place**: each word becomes text drawn in rendering mode 3 — which paints nothing — positioned
   at the box it came from and stretched with `Tz` to that box's width, so a selection follows the
   marks rather than the font's own spacing. The baseline sits a fifth of the box's height above
   its foot, which is where a line of type sits.
6. **Apply** as one `addRecognisedText` operation across every page that was read: one revision,
   one undo, and the same safe save as every other change.

## What the page keeps

Everything. The picture the page arrived with is untouched; the words go on top of it inside
`/PFOcr BMC … EMC`, which is how PaperForge finds its own work again. Reading a page a second time
replaces the words rather than leaving two sets of them, and reading a page that turns out to have
nothing on it takes the old words off.

Because the layer is marked like the rest of PaperForge's furniture, Remove — from the watermark
and header tools — can take it off again as well.

## Languages

Language packs are `.traineddata` files in a `tessdata` folder on this computer. PaperForge lists
what Tesseract reports (`--list-langs`), lets the reader point at a different folder, and
**downloads nothing**: there is no language downloader in v1 and no network call anywhere in this
pipeline.

Settings → Text recognition shows where Tesseract and its language data were found, and keeps the
default language and resolution.

## Stopping and starting again

Pages are read one at a time. Cancelling stops before the next page and keeps every page already
read: the words for those pages are written as usual, and the dialog says the run was stopped.
Running it again over the rest is the way to finish — the pages already done would simply be
replaced with the same words.

## Limits today

- **PaperForge draws the invisible words with the standard fourteen fonts**, which cover Latin-1.
  A language whose script needs other characters is read, and its words are searchable only as far
  as they fit that encoding; embedding a font for other writing systems belongs with the same work
  in `docs/EDITING_MODEL.md`.
- **The text layer is placed word by word**, not glyph by glyph. A selection therefore follows the
  boxes Tesseract reported rather than the exact stroke of each letter.
- **Confidence is reported, not acted on.** Every word Tesseract read goes on the page; the dialog
  says how sure it was overall so the reader can judge whether to try a higher resolution.
- **PaperForge does not deskew or despeckle.** The cleanup is greyscale and contrast; Tesseract's
  own orientation detection does the rest.
- **Tesseract is not bundled.** It is a separate program under an Apache-2.0 licence; PaperForge
  finds it where it was installed, or where the reader points, and says plainly when it is not
  there.
