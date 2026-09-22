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
