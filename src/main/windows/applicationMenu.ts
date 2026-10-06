import { Menu, type BrowserWindow } from 'electron';

/**
 * PaperForge draws its own menus inside the window, from the command registry,
 * and handles its own shortcuts there. Electron's default application menu is
 * not PaperForge's: Alt would reveal it, and its accelerators — Reload, Force
 * Reload, Toggle Developer Tools, the zoom items — would act on the window
 * behind the app's back. Ctrl+R would throw away the window's state, and
 * Ctrl+0, Ctrl+plus and Ctrl+minus would zoom the whole interface instead of
 * the page. So there is no application menu at all.
 */
export function removeApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}

/**
 * Without the default menu, a development build would lose its way to the
 * developer tools. F12 and Ctrl+Shift+I open them there; a packaged build has
 * the tools disabled outright (`webPreferences.devTools`), and never gets this.
 */
export function attachDevToolsShortcut(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const chord =
      input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (!chord) return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });
}
