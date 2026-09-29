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

## Logging and privacy

Logs are local only, in `%APPDATA%/PaperForge/logs/paperforge.log`, rotated at 1 MB. The logger
redacts password, passphrase, secret and token values before writing. Document content is not
logged; file names appear only in the open/close lines. Nothing is transmitted anywhere: PaperForge makes no network requests, and the dev server
is bound to `127.0.0.1`.

## Planned controls

These belong to later segments and are listed so they are not forgotten:

- Redaction must remove content, not cover it, and a test must prove the text cannot be extracted
  afterwards (Segment 15). The object-deletion work above is the foundation for it.
