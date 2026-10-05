# Comments and annotations

How a mark gets from the pointer into the PDF, and back out again.

## Real annotations, not a side file

Every comment PaperForge makes is an annotation dictionary in the page's `/Annots`, with the
entries its subtype is defined by and an appearance stream PaperForge draws itself. Nothing is kept
in an application database. Open the file in Acrobat, a browser or a phone and the marks are there,
drawn the same way.

| Tool                                          | Subtype                                            | Carries          |
| --------------------------------------------- | -------------------------------------------------- | ---------------- |
| Highlight, underline, strikethrough, squiggly | `/Highlight` `/Underline` `/StrikeOut` `/Squiggly` | `/QuadPoints`    |
| Sticky note                                   | `/Text`                                            | `/Name /Comment` |
| Text box                                      | `/FreeText`                                        | `/DA`            |
| Callout                                       | `/FreeText` + `/IT /FreeTextCallout`               | `/CL`, `/RD`     |
| Rectangle, ellipse                            | `/Square` `/Circle`                                | `/RD`, `/IC`     |
| Line, arrow                                   | `/Line`                                            | `/L`, `/LE`      |
| Polygon, polyline                             | `/Polygon` `/PolyLine`                             | `/Vertices`      |
| Freehand                                      | `/Ink`                                             | `/InkList`       |
| Stamp, image stamp                            | `/Stamp`                                           | `/Name`, `/RD`   |

Shared entries: `/Rect`, `/C` and `/IC` for colour, `/CA` for opacity, `/BS` for the border,
`/T`, `/Subj` and `/Contents` for the author, subject and text, `/CreationDate` and `/M`, `/F 4`
so the mark prints, and `/AP /N` — the appearance.

Two entries deserve a word:

- **`/NM`** carries a PaperForge id. Every change rewrites the whole file, so the annotation needs
  an identity of its own for the comments panel to keep pointing at the same one.
- **`/RD`** records the difference between the annotation rectangle and the shape inside it. The
  rectangle has to cover the stroke, which is centred on the shape's edge; without `/RD` a
  read-modify-write cycle takes the padded rectangle for the shape and grows it a little every
  time.

## Appearances

PaperForge writes an appearance stream for every annotation rather than relying on each reader to
synthesise one. The operators are written in page coordinates and the form's `/BBox` is the
annotation rectangle, which makes the mapping from form space to page space the identity.

A highlight is filled through an `ExtGState` with `/BM /Multiply`, so the words underneath stay
readable. Text is drawn in Helvetica — the one font every reader has — and characters it cannot
draw are shown as `?` in the _appearance_ while `/Contents` keeps what was actually typed, in full
Unicode.

## Where the work happens

```
renderer                                     main process
────────                                     ────────────
pointer / text selection
  → geometry in PDF user space
  → transaction ──────────IPC───────────────▶ validate
                                              engine.apply → new revision
                          ◀── DocumentEditState
pending mark drawn over the page ──▶ viewer loads the revision, PDF.js paints the appearances
annotations:list ────────IPC───────────────▶ engine.readAnnotations
```

The finished mark is drawn by the engine, from the file: the renderer draws the shape being
dragged out, the selection outline and the hit areas. For the fraction of a second between the end
of a gesture and the page being drawn again, the new mark is shown over the page in its own colours
(`PendingAnnotationMark`), so it never disappears and comes back. That stand-in is close to the
finished mark rather than a second rendering of it, and it goes as soon as the page shows the real
one.

Text markup uses the browser's own selection rectangles from the text layer, so a highlight lands
exactly on the glyphs rather than on a guess at where the words are.

The pointer layer has three modes: **draw** takes the pointer for itself, **erase** and **select**
leave it on the marks, because both act on what is already there.

## Reading, including what somebody else wrote

The comments panel lists what the file contains, not what PaperForge put there. An annotation from
another application appears with its author, date, colour and text.

When PaperForge cannot reconstruct an annotation's geometry — a subtype it does not draw, or
entries it cannot make sense of — the annotation is still listed, marked `editable: false`. Its
text and status can be changed and it can be deleted; its appearance cannot, because redrawing it
would mean replacing a mark PaperForge does not understand.

## The resolved flag

PDF has no portable "this is dealt with" flag. PaperForge writes `/PFStatus (resolved)` on the
annotation: it survives a round trip through PaperForge, and other readers ignore it. The comments
panel says so under the list rather than implying it is a standard state.

## What is not here yet

- **XFDF import and export.** Worth having for sending comments back and forth with Acrobat; it is
  a separate format with its own fidelity questions, and nothing in the local workflow needs it.
- **File attachment annotations**, which need embedded files — that is the attachment work in
  Segment 14.
- **Measurement annotations**, which `CLAUDE.md` section 32 puts with the practical tools.
- **Resizing by handle.** A mark can be moved; changing its size means drawing it again. Text
  markup and ink are deliberately not resizable at all: one belongs to the words it marks, the
  other to the movement of the hand.
- **A font choice for text boxes.** Helvetica only, stated in the properties panel.
