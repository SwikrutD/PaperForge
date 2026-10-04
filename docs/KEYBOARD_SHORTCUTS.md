# Keyboard shortcuts

PaperForge follows standard Windows accelerators. Every shortcut is bound to a command in the
central registry (`src/renderer/commands`), so menus, the rail, the command palette and the
keyboard all invoke the same implementation. A chord is declared once, on the command; the registry
refuses to start if two commands claim the same one.

## Implemented

| Keys           | Command           | Notes                                                                        |
| -------------- | ----------------- | ---------------------------------------------------------------------------- |
| `Ctrl+O`       | Open…             | Native Windows file picker; several files at once                            |
| `Ctrl+P`       | Print…            | Pages, copies, scaling and printer; or the Windows print dialog              |
| `Ctrl+W`       | Close Document    | Asks first when the document has unsaved changes                             |
| `Ctrl+Shift+W` | Close Window      | Closes this window only                                                      |
| `Ctrl+K`       | Command Palette   | Search every command; unavailable ones show their reason                     |
| `Ctrl+,`       | Settings          | Appearance, privacy and session restore                                      |
| `Ctrl+=`       | Zoom In           | The `=` key is the one `+` shares; also on the viewer toolbar                |
| `Ctrl+-`       | Zoom Out          |                                                                              |
| `Ctrl+0`       | Fit Page          | Fits the page being read                                                     |
| `Ctrl+1`       | Actual Size       | 100%                                                                         |
| `Ctrl+2`       | Fit Width         | Fits the widest page, so nothing scrolls sideways                            |
| `Ctrl+S`       | Save              | Writes the changes back to the file the document came from                   |
| `Ctrl+Shift+S` | Save As…          | Writes to a new file and carries on there                                    |
| `Ctrl+Z`       | Undo              | Steps back through the changes made in this session                          |
| `Ctrl+Y`       | Redo              | Steps forward again                                                          |
| `Ctrl+F`       | Find              | Opens the find bar over the document and selects what is in it               |
| `Ctrl+H`       | Find Options      | Find, with the scope and page-range row expanded                             |
| `F3`           | Find Next         | Wraps around; works while the find field has focus                           |
| `Shift+F3`     | Find Previous     |                                                                              |
| `Ctrl+M`       | Comment           | Show or hide the comment tools                                               |
| `Ctrl+E`       | Edit PDF          | Show or hide the text editor                                                 |
| `Ctrl+N`       | Create PDF        | Make a document from images, text files, web pages or other PDFs             |
| `Ctrl+Shift+P` | Organize Pages    | Show or hide the page grid                                                   |
| `Ctrl+Shift+H` | Hand Tool         | Drag the pages; press again for the select tool                              |
| `Ctrl+Shift+M` | Marquee Zoom      | Drag a rectangle to zoom to it; click zooms in, `Shift`+click zooms out      |
| `Ctrl+L`       | Presentation Mode | One page at a time over the whole screen; `Esc` or `Ctrl+L` stops            |
| `Ctrl+Shift+R` | Reading Mode      | Only the title bar and the document; `Esc` leaves it                         |
| `F4`           | Tools Panel       | Show or hide the right panel                                                 |
| `F6`           | Next Region       | Cycle command bar → rail → left panel → workspace → tools panel → status bar |
| `F11`          | Full Screen       | Uses the real window, not HTML fullscreen                                    |
| `Alt+F4`       | Close window      | Native; window position and size are saved                                   |

Shell behaviour that needs no chord:

| Keys                       | Behaviour                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `Tab` / `Shift+Tab`        | Move between controls, with a visible focus ring                                                 |
| Middle-click a tab         | Close that document                                                                              |
| `Arrow keys`               | Move within a menu, the palette results, the theme options, or a divider                         |
| `Ctrl+wheel`               | Zoom the document                                                                                |
| `Page Up` / `Page Down`    | Scroll the page column by a screen                                                               |
| `Home` / `End`             | Jump to the start or the end of the document                                                     |
| `Home` / `End`             | On a panel divider: minimum and maximum width                                                    |
| `Enter` / `Space`          | Activate the focused control                                                                     |
| `Escape`                   | Close the palette, a menu, a dialog, the find bar or reading mode, or go back to the select tool |
| `Ctrl+A` in the page grid  | Choose every page; `Escape` chooses none                                                         |
| `Delete` in the page grid  | Remove the chosen pages                                                                          |
| `Arrow keys` in the grid   | Move the chosen page; with `Shift`, extend the selection                                         |
| Double-click a page        | Leave the grid and read that page                                                                |
| `Enter` in the find field  | Next match; `Shift+Enter` for the previous one                                                   |
| `F2` in the bookmarks      | Rename the selected bookmark; `Enter` keeps the new title, `Escape` abandons it                  |
| `Delete` in the bookmarks  | Delete the selected bookmark and what is nested under it                                         |
| `Alt+Shift+Up` / `Down`    | In the bookmarks: move the selected bookmark up or down                                          |
| `Alt+Shift+Right` / `Left` | In the bookmarks: nest it under the one above, or move it out a level                            |
| `Enter` while measuring    | Finish a perimeter or area; `Backspace` removes the last point, `Escape` abandons the shape      |
| `Shift` while measuring    | Keep the next segment level, upright or at 45°                                                   |

Bare printable keys are suppressed while the focus is in a text field. Function keys are not:
`F3` has to keep stepping through matches while the find field has focus, and `F4`, `F6` and `F11`
type nothing either. Chords with `Ctrl` or `Alt` always work, which is what Windows applications do.

## Planned

Taken from `CLAUDE.md` section 7; each lands with the segment that implements the command.

| Keys                           | Command                       | Segment  |
| ------------------------------ | ----------------------------- | -------- |
| `Ctrl+Shift+O`                 | Open recent / open options    | later    |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Paste in context | 6 onward |
| `Ctrl+A`                       | Select all text or comments   | later    |

In a continuously scrolling column, `Page Up`, `Page Down`, `Home` and `End` scroll the document,
which is what those keys do in every Windows reader. Explicit page navigation — next page, previous
page, first, last, and the page box — is on the viewer toolbar and in the View menu.

In single page view (View > Single Page View, or the toolbar toggle), with the pages focused:

| Keys                    | Behaviour                                                                    |
| ----------------------- | ---------------------------------------------------------------------------- |
| `Page Down` / `Page Up` | Scroll a page taller than the window, then turn to the next or previous page |
| `Right` / `Left`        | Turn the page, unless the page is wider than the window and scrolls sideways |
| `Home` / `End`          | First or last page                                                           |
| Wheel                   | Scroll the page; keep scrolling past its foot or top to turn it              |

In presentation mode:

| Keys                                                                              | Behaviour                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------- |
| `Right`, `Down`, `Page Down`, `Space`, `Enter`, `N`, a click, wheel down          | Next page                                    |
| `Left`, `Up`, `Page Up`, `Backspace`, `Shift+Space`, `P`, `Shift`+click, wheel up | Previous page                                |
| `Home` / `End`                                                                    | First or last page                           |
| `Esc` or `Ctrl+L`                                                                 | Stop, back in the viewer at the page reached |

`Tab` stays in the presentation, and a link on the page still follows on a click.

The left panel deliberately has no chord yet: `Ctrl+B` is reserved until the text editor
(Segment 9) decides whether it needs it for bold. The rail button and the View menu cover it.

This table is the source of truth for shortcut assignment; update it in the same commit as the
command it describes.
