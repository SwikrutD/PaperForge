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
| `F4`           | Tools Panel     | Show or hide the right panel                                                 |
| `F6`           | Next Region     | Cycle command bar → rail → left panel → workspace → tools panel → status bar |
| `F11`          | Full Screen     | Uses the real window, not HTML fullscreen                                    |
| `Alt+F4`       | Close window    | Native; window position and size are saved                                   |

Shell behaviour that needs no chord:

| Keys                    | Behaviour                                                                |
| ----------------------- | ------------------------------------------------------------------------ |
| `Tab` / `Shift+Tab`     | Move between controls, with a visible focus ring                         |
| Middle-click a tab      | Close that document                                                      |
| `Arrow keys`            | Move within a menu, the palette results, the theme options, or a divider |
| `Ctrl+wheel`            | Zoom the document                                                        |
| `Page Up` / `Page Down` | Scroll the page column by a screen                                       |
| `Home` / `End`          | Jump to the start or the end of the document                             |
| `Home` / `End`          | On a panel divider: minimum and maximum width                            |
| `Enter` / `Space`       | Activate the focused control                                             |
| `Escape`                | Close the palette, a menu or a dialog                                    |

Bare-key shortcuts (`F4`, `F6`, `F11`) are suppressed while the focus is in a text field; chords
with `Ctrl` or `Alt` still work, which is what Windows applications do.

## Planned

Taken from `CLAUDE.md` section 7; each lands with the segment that implements the command.

| Keys                           | Command                           | Segment  |
| ------------------------------ | --------------------------------- | -------- |
| `Ctrl+Shift+O`                 | Open recent / open options        | 4        |
| `Ctrl+S`                       | Save                              | 5        |
| `Ctrl+Shift+S`                 | Save As                           | 5        |
| `Ctrl+P`                       | Print                             | 18       |
| `Ctrl+F`                       | Find                              | 4        |
| `Ctrl+H`                       | Advanced search                   | 4        |
| `Ctrl+Z` / `Ctrl+Y`            | Undo / Redo                       | 5        |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Paste in context     | 4 onward |
| `Ctrl+A`                       | Select all in the current context | 4 onward |

In a continuously scrolling column, `Page Up`, `Page Down`, `Home` and `End` scroll the document,
which is what those keys do in every Windows reader. Explicit page navigation — next page, previous
page, first, last, and the page box — is on the viewer toolbar and in the View menu.

The left panel deliberately has no chord yet: `Ctrl+B` is reserved until the text editor
(Segment 9) decides whether it needs it for bold. The rail button and the View menu cover it.

This table is the source of truth for shortcut assignment; update it in the same commit as the
command it describes.
