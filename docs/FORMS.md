# Forms, signing and flattening

How PaperForge reads a form, fills it in, makes one, and turns the result into part of the page.

Everything here is ordinary AcroForm work through `pdf-lib`, wrapped in the same operation, undo
and save pipeline as every other change (`docs/EDITING_MODEL.md`). No part of it runs JavaScript,
and no part of it claims to be a cryptographic signature.

## The model

`src/pdf/forms/read.ts` reads the whole form at once — a field can be drawn on several pages, and a
form is small next to the document it sits on. Each field reports:

| What                            | Where it comes from                                   |
| ------------------------------- | ----------------------------------------------------- |
| Name, type, value, options      | The field itself, through `pdf-lib`'s typed accessors |
| Widgets: page and rectangle     | `/Kids`, each widget's `/Rect` and the page it names  |
| Required, read-only             | The field flags                                       |
| Multiline, password, max length | `/Ff` and `/MaxLen`                                   |
| Alignment, font size            | `/Q` and the size in `/DA`                            |
| Tooltip                         | `/TU`                                                 |
| Carries an action               | `/A` or `/AA` on the field or one of its widgets      |
| Rule                            | `/PFRule`, which PaperForge wrote (see below)         |

A radio group is one field with one widget per option; the editor draws a control for each, and the
option a widget stands for is the one at its index.

The model carries the revision it was read from. Every change rewrites the document, so the window
reads the form again after each one rather than patching what it has.

## Filling in

`setFieldValues` writes one or more values in a single undoable step. A value goes in through the
field's own type: text is cut to `/MaxLen`, an option the field does not offer is refused, a
read-only field is left alone.

The appearance of the fields that changed is drawn again — only those, so a field whose appearance
the document itself authored is untouched — and `/NeedAppearances` is cleared, because PaperForge
has just drawn what it says needs drawing. A reader that generates no appearances of its own still
shows what was filled in.

**In the window**, each widget becomes a real control sitting exactly where the field is drawn, so
Tab moves on, Space ticks and a screen reader reads the field's name. While filling, the page is
rendered with PDF.js's `ENABLE_FORMS` annotation mode, which leaves the widgets out of the canvas:
otherwise the page would show what a field holds and the control would show it again, half a line
apart.

Typing is held until the field is left. Every change makes a revision and redraws the page, and a
sentence should be one undo rather than forty. A tick, a choice or a picked option is written at
once — and shown at once, before the round trip finishes, so the control never feels stuck.

Changes go through a queue, one at a time, and the form is read again after each. Two in flight at
once would each work from what the form held before the other, and a total would come out wrong.

## What a field takes, and what it works out

Acrobat writes these as document JavaScript. PaperForge will not run JavaScript, so it will not
write any either. A rule lives in the field's own dictionary under `/PFRule`, which every other
reader ignores:

```
/PFRule << /Format /number /Calc << /Kind /sum /Fields [ (order.a) (order.b) ] >> >>
```

- **Format** — `text`, `number` or `date`. A value that does not match is refused before anything is
  written, and the field says why. A date is read both the way the world writes them (23/09/2026)
  and the way a computer does (2026-09-23).
- **Calculation** — the `sum`, `product` or `average` of the named fields. PaperForge works it out
  itself when a value changes and writes the answer beside it, in the same change and the same undo.
  Only what reads as a number takes part; a field holding something else counts as nothing.

A field that carries the document's own JavaScript is marked as such in the panel, and nothing is
run: whatever it would have worked out is not worked out here, and the reader is told so.

## Making a form

Prepare Form is its own way of working. Pick a kind of field, drag where it goes, and the panel says
what it will accept: name, tooltip, required, read-only, several lines, hidden text, a limit on
length, alignment, the choices it offers, and the rule above. Fields move and resize by dragging.

Renaming makes the field again under the new name. A field's name is where it sits in the form's
tree rather than a label on it, so writing a new `/T` would move it somewhere it does not belong;
PaperForge reads what the field is, makes an identical one under the new name and removes the old.
A field carrying an action is refused outright, because renaming would mean dropping the action on
the floor.

A signature field is written as a read-only text field. `pdf-lib` does not author signature fields,
and PaperForge does not sign with certificates: it is somewhere to put a mark, and it says so.

## Simple signatures

A signature is a picture placed on the page as a stamp annotation — so it can be picked up, moved
and taken off like any other mark, and it survives a save and a reopen.

- **Drawn** with the pointer on a white surface, then cropped to the ink.
- **Typed**, and rasterised in the window with a face this computer already has. Nothing is
  embedded in the document, so no font program is redistributed.
- **Brought in** as a PNG or JPEG. A picture with no transparency of its own is treated as ink on
  paper: anything light enough to be paper is made transparent, the edges fade so they stay smooth,
  and the result is cropped to what is left.

A signature is kept for next time only when the reader ticks Remember, and then only in this
computer's application data (`signatures.json`). Nothing is ever sent anywhere, and
Settings → Privacy clears the lot.

Today's date goes on as a text box rather than a picture, so it can still be read, searched and
copied.

**It is a visual mark and nothing more.** PaperForge does not sign with a certificate, does not
validate one, and no wording in the interface suggests otherwise.

## Flattening

Flattening draws what a field holds, or what a mark shows, onto the page and then takes the field or
the mark away. The appearance the annotation already carries is used as it is — mapped onto its
rectangle the way the specification says a form appearance is mapped — so nothing about how the page
looks changes.

It cannot be undone once the file is written, so the dialog writes a copy unless the reader chooses
otherwise, and says plainly what will stop being editable.

## Limits today

- **No certificate-based signing, and no validation of one.** A document that carries a digital
  signature is shown; PaperForge neither checks it nor claims to.
- **PaperForge runs no document JavaScript.** A form that calculates with a script keeps its script
  and PaperForge leaves it alone; its own arithmetic is the three above.
- **A radio group's options are fixed when the field is made.** Changing them means making the
  field again, because each option is a widget in its own right.
- **Border and fill colours are the ones `pdf-lib` gives a new field**; the panel does not offer
  them yet.
- **Signature fields are read-only text fields.** Every reader shows them, none pretends to
  validate them, and a mark goes on top of them like any other.
- **An XFA form is not supported.** PaperForge reads the AcroForm underneath it, which is what most
  such documents also carry.
- **Field names are addressed as the document writes them** — `person.name` is a field named `name`
  under a parent named `person`, and that is the name PaperForge shows and writes.
