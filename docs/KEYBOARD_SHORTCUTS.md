# Keyboard shortcuts

PaperForge follows standard Windows accelerators. Every shortcut will be bound to a command in the
central command registry (Segment 1), so menus, toolbars, context menus and the command palette all
invoke the same implementation.

## Implemented

Segment 0 ships the application shell only. Its interactive controls are reachable with the
standard platform behaviour, and nothing is mouse-only:

| Keys                | Behaviour                                                |
| ------------------- | -------------------------------------------------------- |
| `Tab` / `Shift+Tab` | Move between controls, with a visible focus ring         |
| `Arrow keys`        | Move between the Appearance options (native radio group) |
| `Space` / `Enter`   | Activate the focused control                             |
| `Alt+F4`            | Close the window (window position and size are saved)    |

## Planned

Taken from `CLAUDE.md` section 7; each lands with the segment that implements the command.

| Keys                           | Command                            | Segment  |
| ------------------------------ | ---------------------------------- | -------- |
| `Ctrl+O`                       | Open                               | 2        |
| `Ctrl+Shift+O`                 | Open recent / open options         | 2        |
| `Ctrl+S`                       | Save                               | 5        |
| `Ctrl+Shift+S`                 | Save As                            | 5        |
| `Ctrl+W`                       | Close tab                          | 2        |
| `Ctrl+Shift+W`                 | Close window                       | 2        |
| `Ctrl+P`                       | Print                              | 18       |
| `Ctrl+F`                       | Find                               | 4        |
| `Ctrl+H`                       | Advanced search                    | 4        |
| `Ctrl+Z` / `Ctrl+Y`            | Undo / Redo                        | 5        |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Paste in context      | 3 onward |
| `Ctrl+A`                       | Select all in the current context  | 3 onward |
| `Ctrl++` / `Ctrl+-`            | Zoom in / out                      | 3        |
| `Ctrl+0`                       | Fit page                           | 3        |
| `Ctrl+1`                       | Actual size                        | 3        |
| `Ctrl+2`                       | Fit width                          | 3        |
| `Ctrl+K`                       | Command palette                    | 1        |
| `F4`                           | Toggle the tools pane              | 1        |
| `F6`                           | Cycle major regions                | 1        |
| `F11`                          | Full screen / reading mode         | 4        |
| `Page Up` / `Page Down`        | Previous / next page               | 3        |
| `Home` / `End`                 | First / last page (viewer focused) | 3        |

This table is the source of truth for shortcut assignment; update it in the same commit as the
command it describes.
