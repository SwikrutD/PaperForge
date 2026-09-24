# QA checklist

Automated gates run on every segment:

```sh
npm run typecheck && npm run lint && npm test && npm run package
```

Manual checks are listed per segment and are cumulative — a later segment must not break an earlier
segment's checks.

## Every segment

- [ ] `npm install` on a clean clone succeeds (approve Electron's install script when npm asks).
- [ ] `npm run dev` opens a window with no errors in the terminal and none in
      `%APPDATA%/PaperForge/logs/paperforge.log`.
- [ ] `npm run package`, then launching `out/PaperForge-win32-x64/PaperForge.exe`, works with the
      same result as the dev run.
- [ ] No feature is visible in the UI that does not actually work.
- [ ] Light and dark themes both look correct for anything new.
- [ ] Every new control is reachable and operable by keyboard, with a visible focus ring.
- [ ] `PROGRESS.md` and the affected documents are updated.

## Segment 0 — foundation

Run in both `npm run dev` and the packaged build:

- [ ] The window opens at a sensible size, with the PaperForge icon in the taskbar.
- [ ] The header shows the mark, the product name and the version.
- [ ] Appearance → Light switches to the light theme immediately; Dark switches to dark.
- [ ] With Appearance set to System, changing the Windows setting (Settings → Personalisation →
      Colours → "Choose your mode") updates the app while it stays open.
- [ ] The status bar reports `Ready`, `No document open`, and the resolved theme.
- [ ] The Environment card lists version, build, Electron, Chromium, Node, platform, locale and the
      settings and log folders — all with real values.
- [ ] "Copy diagnostics" puts that list on the clipboard and the button confirms with "Copied".
- [ ] Resize and move the window, close it, reopen it: the geometry is restored. Maximise, close,
      reopen: it reopens maximised.
- [ ] `%APPDATA%/PaperForge/settings.json` contains valid JSON with the current theme and window
      state.
- [ ] Corrupt `settings.json` (for example replace it with `{`), start the app: it opens with
      defaults and logs a warning instead of failing.
- [ ] Delete `settings.json`, start the app: defaults are used and the file is recreated on close.
- [ ] Start a second instance: the existing window is focused instead of a second one opening.
- [ ] Windows display scaling at 125%, 150% and 200%: the layout stays legible and uncropped.
- [ ] Shrink the window to its minimum: nothing overlaps or disappears.
- [ ] Nothing in the app reaches the network, and the log contains no request-like activity.

## Segment 1 — shell and command system

Run in both light and dark themes:

- [ ] Menus open by click and by keyboard (`Enter`/`Down` on a menu, arrows to move, `Escape` to
      close, `Left`/`Right` between menus). Only View, Tools and Help appear, because only those
      have commands.
- [ ] `Ctrl+K` opens the command palette; typing filters; `Up`/`Down` moves; `Enter` runs;
      `Escape` closes. Unavailable commands stay listed with the reason why.
- [ ] Theme commands in the View menu show a tick next to the active one, and switching from the
      menu, the palette or Settings all have the same effect.
- [ ] `F4` toggles the tools panel, `F11` enters and leaves real full screen, `F6` walks the
      command bar, rail, left panel, workspace, tools panel and status bar in order with a visible
      focus ring on each.
- [ ] Rail buttons switch the left panel; clicking the active one collapses the panel.
- [ ] Drag each divider: the panel resizes smoothly, and the width survives a restart. With the
      divider focused, arrows resize in steps and `Home`/`End` jump to the limits.
- [ ] Hide the command bar from the View menu, restart, and confirm it stays hidden.
- [ ] Settings (`Ctrl+,`) opens, traps Tab, closes on `Escape`, and returns focus to whatever
      opened it. The same for About.
- [ ] "Clear Recent Files" is disabled with an explanatory tooltip while the list is empty.
- [ ] "Copy Diagnostics" copies the environment block and shows a toast; the toast dismisses itself.
- [ ] Background tasks opens the progress centre and shows the "Nothing running" state.
- [ ] Every tool card on the home screen is disabled, says "Not yet available", and does nothing
      when clicked. The tools panel shows its empty state rather than a list of dead entries.
- [ ] Narrow the window to its minimum: the shell stays usable and nothing overlaps.

## Segment 2 — files, tabs and recovery

- [ ] `Ctrl+O` opens the Windows file picker; choosing several PDFs opens a tab for each.
- [ ] Dragging PDFs from Explorer onto the window opens them; the drop overlay appears while
      dragging and disappears when the pointer leaves.
- [ ] Dropping a file that is not a PDF shows an error toast naming the file, and opens nothing.
- [ ] The document view shows the real location, size, modified time and PDF version, and marks a
      read-only or password-protected file.
- [ ] Tabs: click to switch, middle-click to close, drag to reorder, right-click for close others,
      close to the right, and move left/right.
- [ ] `Ctrl+W` closes the active document; the next tab becomes active; closing the last one
      returns to the home screen.
- [ ] Recent files: a freshly opened file appears at the top, clicking a row opens it, pin moves it
      to the top and survives a restart, remove takes it out of the list.
- [ ] Clicking a recent file that has since been deleted reports "The file could not be found."
- [ ] Edit an open document in another application: the tab shows the changed marker and the
      document view offers the refreshed details.
- [ ] Delete an open document in Explorer: the tab shows the marker and the view says the file is
      no longer there. PaperForge must not modify or recreate it.
- [ ] With "Reopen documents" on, close PaperForge with documents open and restart: the same
      documents come back. With the setting off, they do not.
- [ ] Kill PaperForge from Task Manager with a document open, then start it again: the recovery
      dialog lists that document; Reopen restores it, Discard forgets it.
- [ ] After a normal exit, `%TEMP%/PaperForge/sessions` is empty.
- [ ] Open the same file twice: it activates the existing tab instead of opening a duplicate.
- [ ] Files with spaces and non-ASCII names in their path open and display correctly.
- [ ] "New Window" opens a second window with its own tabs; closing one leaves the other running.

## Segment 3 — the viewer

- [ ] Open a text PDF: pages render, and the text can be selected with the mouse and copied with
      `Ctrl+C`.
- [ ] Open a 500-page document: the first page appears quickly, scrolling stays smooth, and Task
      Manager shows memory settling rather than climbing with every page scrolled past.
- [ ] Scroll to the end of a long document and back: pages redraw and nothing is left blank.
- [ ] Zoom with `Ctrl+=`, `Ctrl+-`, the toolbar and `Ctrl+wheel`; the percentage in the toolbar and
      the status bar agree with what is on screen.
- [ ] Fit width on a document that mixes portrait and landscape pages: nothing scrolls sideways.
- [ ] Fit page shows a whole page; actual size reports 100%.
- [ ] Rotate the view left and right: pages turn, the layout follows, and the file on disk is
      untouched (its modified time does not change).
- [ ] The page box accepts a number and jumps there; next and previous page move one page.
- [ ] Open a document with internal links: clicking one jumps to its destination.
- [ ] Click an external link: PaperForge asks first, and only opens the browser after Confirm.
- [ ] Open a password-protected PDF: the prompt appears, a wrong password says so, and the right
      one opens the document. Cancelling leaves the tab in an honest error state.
- [ ] Open a damaged PDF: the error explains the problem and Try again is offered.
- [ ] Switch between two open documents: each returns to its own scroll position, zoom and
      rotation.
- [ ] In dark mode the page itself stays white; only the surroundings are dark.
- [ ] Pages stay sharp on a high-DPI display and after changing Windows scaling.

## Segment 4 — navigation panels and search

- [ ] Thumbnails: every page has one, the current page is marked and stays in view while scrolling,
      and clicking a thumbnail goes to that page. In a long document, scrolling the panel fast does
      not leave blank frames behind, and memory settles rather than climbing.
- [ ] Bookmarks: the outline matches the one the document declares, including nesting, bold, italic
      and colour. Twisties expand and collapse. Clicking an entry goes to its page; an entry that
      points nowhere is visibly disabled with an explanation, not silently dead.
- [ ] A document with no outline says "No bookmarks" rather than showing an empty box.
- [ ] Attachments: embedded files are listed with their description, an executable or script
      extension carries the warning icon, and nothing in the panel opens a file. The note about
      saving arriving later is present.
- [ ] Layers: a document with optional content lists its groups; toggling one changes what is drawn
      on the page immediately. The note says visibility is view-only, and the file on disk is
      untouched (its modified time does not change).
- [ ] A document without layers says so instead of inventing one.
- [ ] `Ctrl+F` opens the find bar and selects what is already in the field. `Escape` closes it.
- [ ] Typing shows a match count that settles, highlights every match on the visible pages, and
      moves to the first match at or after the page being read — not back to page one.
- [ ] `F3`, `Shift+F3`, `Enter` and `Shift+Enter` step through the matches and wrap around, and
      they keep working while the find field has the focus. The current match is drawn differently
      from the rest and is scrolled into view only when it is off screen.
- [ ] Match case, whole words and highlight all each change the result as described.
- [ ] The results list shows the page and enough text to recognise each match; clicking one goes
      there.
- [ ] Page range: `2-4, 7` searches only those pages; an impossible range explains itself next to
      the field and searches nothing.
- [ ] With two documents open, "All open documents" finds matches in both, names the document in
      the results, and clicking a match in the other document switches to it.
- [ ] Searching a scanned (image-only) document says the pages carry no text rather than "no
      matches", and offers no OCR, because there is none yet.
- [ ] Searching a long document stays responsive while the scan runs, and changing the query
      abandons the previous scan rather than queueing another.
- [ ] Page labels: a document with roman front matter shows `ii (2 of 20)` in the page field;
      typing a label goes to that page, and so does typing a plain page number.
- [ ] Reading mode (`Ctrl+Shift+R`) leaves only the title bar and the document; `Escape` restores
      the shell with the panels as they were.
- [ ] Highlights stay on the words when the page is zoomed and when the view is rotated, on a page
      that carries its own `/Rotate` as well as on an upright one.

## Segment 5 — changing and saving documents

- [ ] Rotate Page Right turns the page on screen and in the thumbnail, and the tab gains the
      unsaved marker. The file on disk does not change (its modified time stays put).
- [ ] View rotation and page rotation are clearly different: turning the view leaves the tab clean,
      turning the page does not.
- [ ] Undo and Redo step back and forward, and their menu entries are disabled with a reason when
      there is nothing to undo or redo.
- [ ] Delete Page removes the page, the page count drops, and undo brings it back in its old place.
- [ ] Delete Page is disabled, with a reason, on a one-page document.
- [ ] `Ctrl+S` saves, the marker clears, and a toast names the file. Reopening the file shows the
      change; opening it in another PDF reader shows the same.
- [ ] Undo still works after a save, and saving again writes the earlier state back.
- [ ] Save As writes a new file, the tab follows it (title, properties panel, recent files), and
      the file it came from is left as it was.
- [ ] Save a Copy writes elsewhere and leaves the document dirty and pointing at the original.
- [ ] Revert to Saved goes back to the last saved state; Redo brings the discarded change back.
- [ ] Save is disabled on a document with no unsaved changes, and on a read-only file it explains
      that Save a Copy is the way.
- [ ] Closing a changed document warns first. Cancel keeps it open; Close without saving discards.
- [ ] Change a document, then change the same file in another application, then save: PaperForge
      says it changed on disk and only overwrites after Overwrite is chosen.
- [ ] Save a document, then watch the tab: saving does not report itself as an outside change.
- [ ] Open a password-protected document and try to rotate a page: PaperForge says plainly that it
      cannot change an encrypted document yet, and nothing is written.
- [ ] Settings → Local tools reports whether qpdf was found, and its version when it is. Locate…
      accepts an executable and the status updates; Use automatic goes back to looking.
- [ ] With qpdf installed, a save still works and is quietly checked; with qpdf absent, saving
      works exactly the same.
- [ ] After a change, `%TEMP%/PaperForge/sessions/<id>/revisions` holds the revision files; closing
      the document removes them, and a clean exit leaves `sessions` empty.
- [ ] Make thirty or more changes to one document: undo keeps working, memory and disk stay bounded,
      and nothing in the UI claims history that is no longer there.
- [ ] Kill PaperForge with unsaved changes, restart: the recovery screen offers the document, and
      the file on disk is untouched.

## Segment 7 — organizing pages

- [ ] `Ctrl+Shift+P`, the Tools menu and the Organize Pages card all open the same page grid, and
      the card is clearly disabled with a reason while no document is open.
- [ ] The grid shows every page, in order, with its position and — where the document numbers its
      own pages — the number it prints.
- [ ] A long document scrolls smoothly: pages are drawn as they come into view, and the grid of a
      thousand-page document does not stall the window.
- [ ] Click chooses one page; `Ctrl`-click adds and removes; `Shift`-click takes a range and keeps
      its anchor when the range is grown again; `Ctrl+A` chooses everything; `Escape` chooses none.
- [ ] Arrow keys move the chosen page a column or a row at a time, `Shift` extends, and the focus
      ring stays visible throughout.
- [ ] Dragging a page shows an indicator in the gap it would land in, and dropping it there moves
      it. Dropping it back where it was changes nothing and adds no undo step.
- [ ] Dragging a multi-page selection moves all of them, keeping their order among themselves.
- [ ] Rotate left/right, Duplicate and Delete act on every chosen page as one undoable step; the
      grid redraws to match, and the tab gains the unsaved marker.
- [ ] Delete is disabled, with a reason, when it would empty the document.
- [ ] Insert → Blank page adds a page after the chosen one, the size of its neighbour.
- [ ] Insert → Pages from a PDF… inserts the whole of the chosen document; the source file is not
      modified.
- [ ] Insert → Image as a page… centres the image on a page of its own.
- [ ] Insert → Replace this page from a PDF… is available only with one page chosen, and replaces
      exactly that page.
- [ ] An encrypted PDF is refused as an insertion source, in plain words.
- [ ] Extract… writes the chosen pages to a file the reader names, leaves this document unchanged,
      and only removes the pages afterwards if that was asked for — never leaving nothing behind.
- [ ] Extract → one document per page writes one file per page into the chosen folder, with names
      that do not collide.
- [ ] Split… lists the pieces before writing: every N pages, explicit ranges, and top-level
      bookmarks. The bookmark option explains itself when the document has none.
- [ ] A split into a folder writes exactly the listed files, and the document it came from is
      unchanged and still clean.
- [ ] Move pages to another document is offered only when another document is open; the pages
      arrive at the end of that document and leave this one, each document keeping its own undo.
- [ ] Crop… insets the chosen pages by the margins given, pages of different sizes included; the
      properties panel shows the new size; Reset crop puts the whole page back.
- [ ] Crop → "Change the page size as well" says what it discards before it is used.
- [ ] Page numbering… renumbers from the chosen page on, keeps numbering already set further on,
      and the grid shows the printed number beside the position.
- [ ] The properties panel names the boxes the chosen page really declares, and says "Not set"
      rather than repeating the media box.
- [ ] Saving writes exactly the order, rotation, cropping and numbering the grid showed; reopening
      the file — in PaperForge and in another reader — shows the same.
- [ ] Nothing in the grid touches the file on disk before a save: the file's modified time stays put
      through every operation above.
- [ ] Done goes back to reading the same document, at the page that was being read.
- [ ] Double-clicking a page leaves the grid and shows that page.
- [ ] The grid and its dialogs are correct in light and dark, at 125% and 150% Windows scaling.

## Segment 8 — creating and combining

- [ ] The Create PDF and Combine Files cards work from the home screen with no document open, and
      `Ctrl+N` and the Tools menu open the same workspace with a document open.
- [ ] The empty workspace says what it wants and offers one way to get it; the count reads "No files
      yet".
- [ ] Add files… accepts PDFs, PNG and JPEG images, text files and local HTML, and lists each one
      with what it was, how many pages it became, and a preview of its first page.
- [ ] A file PaperForge cannot make pages from is listed as a failure by name, with a reason, and
      nothing else in the list is disturbed.
- [ ] An encrypted PDF is refused as a source, in plain words.
- [ ] The count in the toolbar follows the list: files, and the pages the new document will have.
- [ ] A page range on a row changes the count and says how many pages that file contributes; a range
      that is not a range is marked on the field and stops the Combine button, with a reason.
- [ ] Rows reorder by dragging the number on the left, and by the up and down buttons, which are
      disabled at the ends.
- [ ] Rotating a row turns its preview, and the pages it contributes come out turned.
- [ ] Changing the paper or the margin converts the images, text files and web pages again and
      leaves the PDFs alone; the size under the controls follows the choice.
- [ ] "The image's own size" makes each image page the size of the image and its margins.
- [ ] Combine… asks where to save, writes the document, opens it, and clears the list.
- [ ] The document has exactly the pages the list promised, in that order, and the files it was made
      from are unchanged on disk.
- [ ] With "One for each file" on, the outline names each file and goes to its first page.
- [ ] With "Keep the bookmarks" on, a source's own bookmarks appear on the pages they landed on; a
      bookmark whose page was not taken is gone and the ones below it are not.
- [ ] With both on, the carried bookmarks sit under the file they came from.
- [ ] Blank document… makes an empty document of the paper, orientation and page count chosen, opens
      it, and records the title given.
- [ ] Cancelling either save dialog leaves the list as it was and writes nothing.
- [ ] Converting a local web page shows no network activity, and a page that tries to load a remote
      image still converts.
- [ ] Close leaves the workspace without losing the list; opening it again shows the same files.
- [ ] The workspace, its list and the blank dialog are correct in light and dark, at 125% and 150%
      Windows scaling.

## Segment 9 — editing text

- [ ] `Ctrl+E`, the Tools menu and the Edit PDF card all open the text editor, and the card is
      clearly disabled with a reason while no document is open.
- [ ] Every piece of text a page draws gets a box, in the right place, at the right size, including
      text that is turned, scaled or drawn inside a layer.
- [ ] The properties panel names the font, size, colour and position of the selected text, and says
      whether it can be rewritten.
- [ ] Clicking a selected run opens it for typing at the size it is drawn; Enter keeps the change
      and Escape leaves the text as it was.
- [ ] A change is drawn in the font that was already there, and the rest of the page is untouched:
      other runs, drawings and images do not move.
- [ ] Undo, redo and revert work on a text change exactly as they do on a page rotation, and the
      tab's unsaved marker follows.
- [ ] Saving writes what the page shows; reopening the file — in PaperForge and in another reader —
      shows the same.
- [ ] Typing a character the font cannot write asks whether to replace the text instead, naming the
      character; cancelling writes nothing.
- [ ] Agreeing replaces the text: the old glyphs are gone, the new text sits in the same place, and
      what followed on the line has not moved.
- [ ] Text PaperForge drew is marked as such in the properties panel.
- [ ] Text outside Latin-1 — Cyrillic, Greek, CJK — is refused with a plain explanation, and
      nothing is written.
- [ ] A run whose font says nothing about its characters is shown with a reason, and typing in it
      replaces it rather than rewriting it.
- [ ] Add text puts new text where the page is clicked, in the font, size and colour chosen in the
      panel; the page keeps everything it had.
- [ ] A page with no text PaperForge can read says so rather than looking broken.
- [ ] The editor closes with the last document, and Done goes back to reading.
- [ ] The editor and its panel are correct in light and dark, at 125% and 150% Windows scaling.

## Segment 10 — images, links and page furniture

### Images

- [ ] In Edit, the Images button puts a box around every picture the page draws, and the boxes sit
      exactly on the pictures at any zoom, page rotation and view rotation.
- [ ] Clicking one selects it, grows eight handles, and the panel says how many pixels it holds,
      how big it is on the page, where it sits and how far it is turned.
- [ ] Dragging the box moves the picture; dragging a handle resizes it from that handle, with the
      opposite corner staying put; Shift keeps its shape.
- [ ] A picture the page draws at an angle resizes along its own edges, not the page's.
- [ ] Turn left, turn right and the two mirror buttons do what they say, and the selection survives
      each one.
- [ ] A move is one undo, not one per pixel dragged.
- [ ] The picture keeps its place in the drawing order: whatever covered it still covers it, and
      the text around it does not move.
- [ ] Cropping by trimming each edge hides part of the picture without changing its pixel count;
      Reset crop puts it back; cropping twice is not cumulative.
- [ ] The opacity slider reports what the page does, and survives a save and reopen.
- [ ] Replace draws a different picture in the same box, and the panel then says PaperForge added
      it.
- [ ] Save image writes a JPEG untouched, or a PNG of the samples, and says where it went.
- [ ] Delete takes the picture off and leaves everything else; undo puts it back.
- [ ] Add image places a chosen file where the page is clicked, at a sensible size.
- [ ] Everything above survives save, close and reopen — in PaperForge and in another reader.

### Links

- [ ] The Links button shows the links the page already carries, with where each one goes in its
      tooltip.
- [ ] Selecting one says whether it goes to a page or to an address, and its area and position.
- [ ] A link can be pointed at another page, or at an http, https or mailto address; anything else
      is refused before it is written, with a plain reason.
- [ ] A link that carries a launch action or document JavaScript is described, not followed, and is
      left alone unless the reader points it somewhere new.
- [ ] Add link draws the area with a drag; a click that does not travel makes nothing.
- [ ] Dragging a link moves it; the handles resize it; both are one undo each.
- [ ] Deleting a link takes it off the page, and the links survive save and reopen.

### Watermark, background, header and footer

- [ ] Each tool says which pages it applies to, and applying to a range leaves the other pages
      untouched.
- [ ] A watermark can be words or a picture, over the page or under it, at the opacity, angle and
      size chosen; the preview matches what lands on the page.
- [ ] Applying a second watermark replaces the first rather than stacking; Remove takes it off and
      the page underneath is exactly as it was.
- [ ] A background goes under everything the page draws, as a colour or as a picture filled,
      fitted or tiled.
- [ ] A header or footer resolves {{page}}, {{pages}}, {{date}}, {{title}} and {{bates}} page by
      page, and the preview says what the first page will carry.
- [ ] {{page}} starts from the number given, and Bates numbering pads to the digits given with the
      prefix and suffix given.
- [ ] A line left empty writes nothing at all.
- [ ] Every one of them is one undo, and what the pages carry is in the file after a save.
- [ ] All three dialogs are correct in light and dark, at 125% and 150% Windows scaling, and every
      control has a label.

## Segment 11 — forms, signing and flattening

### Filling a form in

- [ ] Fill & Sign puts a control on every field the document carries, exactly where it is drawn, at
      any zoom, page rotation and view rotation.
- [ ] The page no longer shows a field's value twice: the canvas leaves the widgets out while they
      are being filled in.
- [ ] Tab moves from field to field, Space ticks a checkbox, and a screen reader reads each field's
      name or tooltip.
- [ ] Typing is written when the field is left or Enter is pressed — one undo for a sentence, not
      one per keystroke.
- [ ] A tick, a radio choice and a dropdown choice are written at once, and show at once.
- [ ] A read-only field cannot be changed; a required field that is empty is counted in the bar.
- [ ] Highlight fields tints every field, and turning it off leaves the page as the document draws
      it.
- [ ] Empty the form clears everything that can be changed, asks first, and can be undone.
- [ ] What was filled in is in the saved file, and is still there when it is reopened — in
      PaperForge and in another reader.
- [ ] A form carrying JavaScript says so in the bar, and nothing runs.

### What a field takes, and what it works out

- [ ] A field set to take a number refuses a word, marks itself, and says why in the panel; nothing
      is written.
- [ ] A field set to take a date accepts both 2026-09-23 and 23/09/2026, and refuses 31/02/2026.
- [ ] A total set to the sum, product or average of other fields works itself out as they are
      filled in, in the same undo step.
- [ ] Nothing in the written file is a script: the rule is PaperForge's own entry and the document
      carries no JavaScript.

### Signing

- [ ] A signature can be drawn, typed or brought in as a picture, and the dialog says plainly that
      it is a mark rather than a certificate-based signature.
- [ ] A drawn or typed mark is cropped to itself; an imported photograph has its paper cleared away
      and its ink kept.
- [ ] The mark goes where the page is clicked, and can then be moved, resized and deleted like any
      other mark.
- [ ] Moving a placed signature keeps the picture — it does not become an empty box.
- [ ] Initials work the same way, and are kept apart from signatures in the list.
- [ ] Today's date goes on as text that can be selected and searched.
- [ ] A signature is kept only when Remember is ticked, appears in the dialog next time, and can be
      forgotten from the dialog or cleared from Settings → Privacy.
- [ ] Marks are in the saved file and come back on reopening.

### Making a form

- [ ] Prepare Form offers each kind of field, and dragging with one chosen draws it there.
- [ ] A new field is selected as soon as it is made, and the panel is about it.
- [ ] Name, tooltip, required, read-only, several lines, hidden text, length limit, alignment and
      options can all be set, and hold after a save and reopen.
- [ ] Renaming a field keeps what it is and where it sits; renaming onto a name already in use is
      refused, as is renaming a field that carries an action.
- [ ] Fields move and resize by dragging, and are taken away by Delete.
- [ ] A form made from nothing can be filled in straight afterwards.
- [ ] A signature field is read-only and says what it is.

### Flattening

- [ ] Flatten says how many fields and marks will be drawn onto the page.
- [ ] Flattening writes a copy by default, and the open document keeps its fields.
- [ ] After flattening in place there is nothing left to fill in, the page looks exactly as it did,
      and undo puts the fields back until the file is saved.
- [ ] Both toolbars and both panels are correct in light and dark, at 125% and 150% Windows
      scaling, and every control has a label.

## Segment 12 — recognising text

- [ ] With Tesseract installed, Recognize Text says which version was found, where it is, and which
      languages are available.
- [ ] With Tesseract missing, the dialog says so plainly and offers to be pointed at a copy; nothing
      pretends to work.
- [ ] Choosing another program, or another tessdata folder, is remembered and can be undone with
      Use automatic.
- [ ] A scanned page is read, and the words it holds can then be found with Ctrl+F, selected and
      copied.
- [ ] The page looks exactly as it did: the words are invisible and the picture is untouched.
- [ ] Selecting a line of the recognised text follows the marks on the page rather than drifting
      away from them.
- [ ] All pages, this page and a page range each read what they say they will.
- [ ] Progress says which page is being read, and the progress centre shows the same job.
- [ ] Stopping a run keeps the pages already read and says so; running it again finishes the rest.
- [ ] Reading a page a second time replaces the words rather than leaving two sets.
- [ ] Turning off "Put the words into the document" reads the pages without changing the file, and
      Save the text writes what was read.
- [ ] "Clean the picture up first" changes what is read, never the document.
- [ ] A page with nothing on it comes back empty and says so rather than failing.
- [ ] What was read is in the file after saving, and is still there when it is reopened.
- [ ] Searching a scan that has not been read offers Recognize Text rather than only explaining the
      silence.
- [ ] Settings → Text recognition shows the same status and keeps the default language and
      resolution.
- [ ] No network connection is needed at any point: with the machine offline, everything above
      behaves the same.
- [ ] The dialog is correct in light and dark, at 125% and 150% Windows scaling, and every control
      has a label.
