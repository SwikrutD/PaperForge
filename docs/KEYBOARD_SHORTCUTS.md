# Keyboard shortcuts

PaperForge follows standard Windows accelerators. Every shortcut is bound to a command in the
central registry (`src/renderer/commands`), so menus, the rail, the command palette and the
keyboard all invoke the same implementation. A chord is declared once, on the command; the registry
refuses to start if two commands claim the same one.

## Implemented

| Keys           | Command         | Notes                                                                        |
| -------------- | --------------- | ---------------------------------------------------------------------------- |
| `Ctrl+O`       | Open…           | Native Windows file picker; several files at once                            |
| `Ctrl+W`       | Close Document  | Asks first when the document has unsaved changes                             |
| `Ctrl+Shift+W` | Close Window    | Closes this window only                                                      |
| `Ctrl+K`       | Command Palette | Search every command; unavailable ones show their reason                     |
| `Ctrl+,`       | Settings        | Appearance, privacy and session restore                                      |
| `Ctrl+=`       | Zoom In         | The `=` key is the one `+` shares; also on the viewer toolbar                |
| `Ctrl+-`       | Zoom Out        |                                                                              |
| `Ctrl+0`       | Fit Page        | Fits the page being read                                                     |
| `Ctrl+1`       | Actual Size     | 100%                                                                         |
| `Ctrl+2`       | Fit Width       | Fits the widest page, so nothing scrolls sideways                            |
| `Ctrl+S`       | Save            | Writes the changes back to the file the document came from                   |
| `Ctrl+Shift+S` | Save As…        | Writes to a new file and carries on there                                    |
| `Ctrl+Z`       | Undo            | Steps back through the changes made in this session                          |
| `Ctrl+Y`       | Redo            | Steps forward again                                                          |
| `Ctrl+F`       | Find            | Opens the find bar over the document and selects what is in it               |
| `Ctrl+H`       | Find Options    | Find, with the scope and page-range row expanded                             |
| `F3`           | Find Next       | Wraps around; works while the find field has focus                           |
| `Shift+F3`     | Find Previous   |                                                                              |
| `Ctrl+Shift+R` | Reading Mode    | Only the title bar and the document; `Esc` leaves it                         |
| `F4`           | Tools Panel     | Show or hide the right panel                                                 |
| `F6`           | Next Region     | Cycle command bar → rail → left panel → workspace → tools panel → status bar |
| `F11`          | Full Screen     | Uses the real window, not HTML fullscreen                                    |
| `Alt+F4`       | Close window    | Native; window position and size are saved                                   |

Shell behaviour that needs no chord:

| Keys                      | Behaviour                                                                |
| ------------------------- | ------------------------------------------------------------------------ |
| `Tab` / `Shift+Tab`       | Move between controls, with a visible focus ring                         |
| Middle-click a tab        | Close that document                                                      |
| `Arrow keys`              | Move within a menu, the palette results, the theme options, or a divider |
| `Ctrl+wheel`              | Zoom the document                                                        |
| `Page Up` / `Page Down`   | Scroll the page column by a screen                                       |
| `Home` / `End`            | Jump to the start or the end of the document                             |
| `Home` / `End`            | On a panel divider: minimum and maximum width                            |
| `Enter` / `Space`         | Activate the focused control                                             |
| `Escape`                  | Close the palette, a menu, a dialog, the find bar or reading mode        |
| `Enter` in the find field | Next match; `Shift+Enter` for the previous one                           |

Bare printable keys are suppressed while the focus is in a text field. Function keys are not:
`F3` has to keep stepping through matches while the find field has focus, and `F4`, `F6` and `F11`
type nothing either. Chords with `Ctrl` or `Alt` always work, which is what Windows applications do.

## Planned

Taken from `CLAUDE.md` section 7; each lands with the segment that implements the command.

| Keys                           | Command                           | Segment  |
| ------------------------------ | --------------------------------- | -------- |
| `Ctrl+Shift+O`                 | Open recent / open options        | later    |
| `Ctrl+P`                       | Print                             | 18       |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Paste in context     | 6 onward |
| `Ctrl+A`                       | Select all in the current context | 6 onward |

In a continuously scrolling column, `Page Up`, `Page Down`, `Home` and `End` scroll the document,
which is what those keys do in every Windows reader. Explicit page navigation — next page, previous
page, first, last, and the page box — is on the viewer toolbar and in the View menu.

The left panel deliberately has no chord yet: `Ctrl+B` is reserved until the text editor
(Segment 9) decides whether it needs it for bold. The rail button and the View menu cover it.

This table is the source of truth for shortcut assignment; update it in the same commit as the
command it describes.
