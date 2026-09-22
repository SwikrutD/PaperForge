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

## Logging and privacy

Logs are local only, in `%APPDATA%/PaperForge/logs/paperforge.log`, rotated at 1 MB. The logger
redacts password, passphrase, secret and token values before writing. Document content is not
logged; file names appear only in the open/close lines. Nothing is transmitted anywhere: PaperForge makes no network requests, and the dev server
is bound to `127.0.0.1`.

## Planned controls

These belong to later segments and are listed so they are not forgotten:

- Document JavaScript is never executed. PaperForge may detect and remove it (Segments 19–22 of the
  spec, implemented in Segments 14 and 15).
- Embedded attachments are never auto-opened; executable and script extensions warn first
  (Segment 14).
- External URLs open only after explicit user confirmation, in the system browser (Segment 24 of
  the spec, implemented alongside links).
- Native sidecars are launched with `execFile`/`spawn` without a shell, with arguments built from
  typed fields, into PaperForge-owned temp directories, and are terminated cleanly on cancel
  (Segments 5, 12 and 13).
