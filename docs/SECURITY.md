# Security model

PaperForge opens untrusted files on a user's own machine and never talks to a network. The threat
model is therefore: a hostile PDF, or hostile content inside one, must not be able to reach the
filesystem, spawn a process, or phone home.

## Electron baseline

Implemented in `src/main`:

| Control                                                                                                             | Where                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `contextIsolation: true`                                                                                            | `windows/mainWindow.ts`             |
| `nodeIntegration: false`                                                                                            | `windows/mainWindow.ts`             |
| `sandbox: true` (+ `app.enableSandbox()`)                                                                           | `windows/mainWindow.ts`, `index.ts` |
| `webviewTag: false`, `navigateOnDragDrop: false`, `experimentalFeatures: false`                                     | `windows/mainWindow.ts`             |
| DevTools only in development                                                                                        | `windows/mainWindow.ts`             |
| Popups denied (`setWindowOpenHandler`)                                                                              | `security/hardening.ts`             |
| Navigation restricted to trusted origins                                                                            | `security/hardening.ts`             |
| `webview` attachment blocked                                                                                        | `security/hardening.ts`             |
| All permission requests denied                                                                                      | `security/hardening.ts`             |
| Device and Bluetooth access denied                                                                                  | `security/hardening.ts`             |
| Certificate errors rejected, never prompted                                                                         | `security/hardening.ts`             |
| Single instance lock                                                                                                | `index.ts`                          |
| Fuses: no `RUN_AS_NODE`, no `NODE_OPTIONS`, no inspect args, cookie encryption, asar integrity, load only from asar | `forge.config.ts`                   |

There is no `eval`, no `new Function`, and no remote module anywhere in the codebase; ESLint fails
the build if one appears.

## Content Security Policy

Built by `src/main/security/csp.ts` and unit-tested.

Production (served over `app://`):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:;
connect-src 'self' blob: data:; worker-src 'self' blob:; child-src 'self' blob:;
object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none';
frame-ancestors 'none'; manifest-src 'none'
```

`blob:` and `data:` stay available for images and workers because PDF.js needs them; scripts stay
restricted to the packaged bundle. `style-src` allows inline styles because component styling
injects them at runtime — that is a deliberate, documented exception and does not extend to
scripts.

Development additionally allows the Vite dev server origin, its websocket, and the inline preamble
React Refresh injects. That relaxation exists only while `MAIN_WINDOW_VITE_DEV_SERVER_URL` is set,
which never happens in a packaged build.

## No network

The CSP keeps the renderer from loading or fetching anything remote. Behind it,
`blockNetwork()` (`src/main/security/hardening.ts`) cancels every `http`, `https`, `ws`, `wss` and
`ftp` request the default session sees — from the main process's own `net` module as much as from
the window — except, in a development build only, requests to the Vite dev server's exact origin.
The hidden windows that convert web pages and print have their own sessions, which refuse the same.
The `offline` end-to-end suite records every request a reading session makes and checks that none
leaves the machine, and that the main process cannot fetch either.

## Renderer origin and path safety

The packaged renderer is served from `app://renderer/` rather than `file://`, so it has a real
origin, a working CSP, and normal fetch semantics for future PDF.js workers. Every request is
resolved through `resolveWithinRoot()`, which rejects `..` segments, absolute paths, Windows drive
qualifiers and NUL bytes, and confirms the result is inside the renderer directory. Rejections are
logged and answered with 403. This is covered by unit tests including spaces and non-ASCII names.

## IPC

- The preload exposes exactly two functions, both channel-allowlisted: `invoke` and `subscribe`.
- The main process rejects any request whose sender frame is not a trusted origin.
- Every request and every response is validated against a Zod schema; a mismatch becomes a typed
  `ipc/invalid-request` or `ipc/invalid-response` error instead of untyped data.
- There is no generic "run this command" or "read this file" channel, and there never will be.

## Files and paths

A recovery journal is read back after a crash, so it is treated as untrusted: the revision it names
is resolved inside that session's own directory with `resolveWithinRoot()`, and a journal that
points anywhere else offers nothing to recover.

- Opening is read-only. PaperForge reads a header and a trailer slice to identify a PDF, and never
  writes to the file the user opened.
- Paths reach the main process only from the native file picker, from a drop the user performed, or
  from the local recent-files list. The preload exposes `getPathForFile`, which resolves the path of
  a file the user just dropped and nothing else — Chromium removed `File.path`, and this is the
  documented replacement.
- A path is accepted as a document only if the file really starts with a PDF header, so an
  extension cannot talk PaperForge into treating something else as a document.
- Working directories live under `%TEMP%/PaperForge/sessions/<session id>` and are removed on close
  and before quitting. They hold PaperForge's own journal, not user content.
- `shell.showItemInFolder` is the only way a path leaves the application, and only for a file the
  user is already working with.

## Documents in the renderer

- Document bytes are served over the `pfdoc` scheme, which resolves only
  sessions that are currently open. A renderer cannot ask for an arbitrary file.
- PDF.js runs with XFA disabled and never executes document JavaScript.
  PaperForge does not enable the PDF.js scripting sandbox.
- Links in a document cannot navigate the application: an internal destination
  scrolls the page column, and an external URL is shown to the user, confirmed,
  and then opened in the system browser by the main process, which accepts only
  `http`, `https` and `mailto`.
- A document password is entered in the renderer and handed straight to the PDF
  engine there. It never crosses IPC, is never persisted, and never reaches the
  log.

## Document security and passwords

PaperForge both reads and writes PDF security, and the two work quite differently.

**Reading** needs nothing installed and no password. The encryption dictionary is stored in the
clear — that is what lets any reader know how to ask for a password — so `src/pdf/security/`
parses it out of the bytes and reports the algorithm, key length, permission bits and whether
metadata was left readable. `standardHandler.ts` goes one step further and answers the question the
dictionary does not state outright: whether a password is needed to open the document at all, or
only to lift its restrictions. It does that by checking whether the _empty_ user password
validates, which is exactly what every reader does before it prompts. It implements algorithm 2 and
algorithm 6 for revisions 2 to 4 and algorithm 2.B for revision 6. It validates and stops; it never
decrypts a document, and a handler it does not recognise is reported as unknown rather than
guessed at.

**Writing** goes through qpdf, launched only by `QpdfSecurity` in the main process:

- arguments are an array, never a shell string, and the run never goes through a shell;
- the input password for `--decrypt` is written to qpdf's standard input via `--password-file=-`
  where the installed version supports it (qpdf 10.2 and later), so it is not in a command line;
- the passwords for `--encrypt` have to go on the command line, because that is the only way qpdf
  accepts them. Another program running as the same user could read them from the process list for
  the moment qpdf runs. This is stated here rather than glossed over;
- anything qpdf prints is scrubbed of every password before it becomes an error, so a password
  cannot reach a toast, a log line or a diagnostics copy;
- both operations write a **new file**. The document the reader has open is never replaced, because
  an encrypted document cannot be edited and swapping one in would take their work away.

Passwords are not written to the log, the settings file or the recovery journal, and the store in
the renderer keeps none after the request is sent. `tests/unit/main/documentAdmin.test.ts` asserts
this rather than leaving it to review.

PDF permissions are cooperative: they are flags a conforming reader agrees to honour, not
enforcement. PaperForge writes them accurately and says nothing about what other software will do
with them.

## Hidden information

`src/pdf/sanitize/` finds what a document carries besides its pages — metadata, XMP, embedded
files, document JavaScript, launch and submit actions, hidden comments, form values, saved
thumbnails, hidden layers and alternate images — and removes only the categories the reader chose.
An action is read far enough to follow its `/Next` chain and is then deleted. Nothing found is ever
performed.

Removal deletes the objects, not only the references to them. pdf-lib writes every indirect object
it holds whether or not anything still points at it, so dropping a name-tree entry would hide an
embedded file while its bytes travelled on into the saved document. `src/pdf/sanitize/prune.ts`
exists for that reason, and a regression test asserts that the bytes of a removed attachment are
nowhere in the saved file.

Embedded files are never opened and never executed. Saving one writes the bytes where the reader
chose and stops there; a name whose extension Windows would run is called out and confirmed first.

## Redaction

Redaction removes content; it does not cover it (`src/pdf/redact/`). Applying a mark:

- **Text** — each glyph whose middle, or at least 30% of whose box, lies under a mark is deleted
  from its show operation and replaced by a `TJ` offset of the same advance, so what stays does not
  move. This needs nothing of the font beyond how it splits a string into codes. `/ActualText`,
  `/Alt` and `/E` on marked content around cut text are deleted too.
- **Pictures** — one wholly under a mark is removed; one partly under it is repainted in its own
  samples when it is stored plain or deflated (8-bit grey, RGB or CMYK, no mask), and written as a
  new image. A picture or group no longer drawn anywhere is deleted from the file, even when
  another page's resources still list it.
- **Drawings** — a path wholly under a mark is removed; one crossing the edge is painted over.
- **Comments and fields** — an annotation under a mark goes, with its pop-up; a widget takes its
  whole field, value and all.
- **Thumbnails** of redacted pages are deleted.

Where a page holds something under a mark that PaperForge cannot cut safely — a font that does not
state its widths, a reusable group (form XObject) only partly covered, a JPEG or masked picture
only partly covered, an inline image, an undecodable content stream — the engine refuses to cut it
natively. The window then draws the page (upright, without annotations, with the marks painted
onto the pixels) and the page is replaced by that picture with fresh resources; nothing of the old
page is kept. The reader sees which pages this applies to, and why, before anything happens.

After cutting, each page is read back with the same model and the whole change is refused if any
glyph, picture or group is still under a mark. Finally every object the document no longer reaches
from its trailer is deleted, because pdf-lib would otherwise write orphaned content streams into
the file. `tests/unit/shared/redaction.test.ts` proves, per case, that the marked text is neither
returned by PDF.js extraction nor present anywhere in the saved bytes, decompressed or not.

Not reached by redaction by area: bookmark titles, document metadata (offered as a "remove hidden
information" option in the same step), and descriptions kept in a tagged document's structure
tree. The review dialog says so when the document has them.

## Comparison, optimisation and repair

- **Comparing** happens entirely in the window: the two documents are read through the same
  `pfdoc` scheme the viewer uses, and pixels go to a module worker built into the bundle
  (`worker-src 'self'`). A document that needs a password is refused rather than prompted for
  twice; the viewer keeps the password it was given to itself.
- **Optimising** decodes and encodes pictures in memory with Chromium's codecs (`nativeImage`); no
  image library is added and nothing is written outside the session's working directory until the
  reader saves. qpdf receives a copy in that directory, with an argument array and no shell, and
  its output is read back before it is used.
- **Repairing** never writes over the file that was opened — the destination is compared with it
  and refused — and the copy is published through the same reopen-and-check path as a save.
  qpdf's messages are shown with the working copy's path replaced by "the document".

## Printing and Windows integration

**Printing.** Pages are drawn by the window and written as PNG files (checked by signature) to a
PaperForge-owned folder under `%TEMP%\PaperForge\print\<job>`, removed when the job is printed,
dismissed or stopped, and cleared at start-up. The print document is loaded in a hidden window with
its own empty session, no JavaScript, no Node, a `default-src 'none'; img-src file:` policy, and a
request filter that refuses every URL outside the job's folder. The document title is escaped.

**Launch arguments.** Files from Explorer, Open With, the jump list or a second launch are reduced
to absolute paths ending in `.pdf`; switches, URLs of any scheme (`file:` included), device and
pipe paths (`\\.\`, and `\\?\` other than long-path spellings) and anything past fifty files are
dropped. They are queued in the main process and opened by the normal open flow, which checks the
file is there and is a PDF. The renderer never names them. PaperForge registers no URL protocol.

**Registry.** The installer events and Settings → Windows write only under `HKEY_CURRENT_USER`,
through `%SystemRoot%\System32\reg.exe` run with an argument array and no shell. PaperForge adds a
ProgID, an Open With entry and Default-apps capabilities for `.pdf`; it never writes the `.pdf`
default or `UserChoice`, and uninstalling removes exactly what it added. Windows Settings is opened
at a fixed `ms-settings:` address, not one the renderer supplies.

**Installer.** A per-user Squirrel installer: no administrator rights, nothing downloaded at
install time (its Apps & features icon is a local file), and no auto-update — PaperForge never
calls the updater.

## Logging and privacy

Logs are local only, in `%APPDATA%/PaperForge/logs/paperforge.log`, rotated at 1 MB. The logger
redacts password, passphrase, secret and token values before writing. Document content is not
logged; file names appear only in the open/close lines. Nothing is transmitted anywhere: PaperForge makes no network requests (and the session refuses
any it is asked to make), and the dev server is bound to `127.0.0.1`.

## Planned controls

These belong to later segments and are listed so they are not forgotten:
