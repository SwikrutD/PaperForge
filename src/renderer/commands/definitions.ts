import {
  Activity,
  AppWindow,
  FolderOpen,
  Bookmark,
  ClipboardCopy,
  Eraser,
  Info,
  Keyboard,
  Layers,
  Maximize2,
  Monitor,
  Moon,
  Paperclip,
  PanelLeft,
  PanelRight,
  PanelTop,
  Search,
  Settings as SettingsIcon,
  SquareX,
  StickyNote,
  Sun,
} from 'lucide-react';
import type { LeftPanelId } from '@shared/schemas/settings';
import { CommandRegistry } from './registry';
import type { CommandDefinition } from './types';

const LEFT_PANELS: Array<{ id: LeftPanelId; title: string; icon: typeof Bookmark }> = [
  { id: 'pages', title: 'Page Thumbnails', icon: StickyNote },
  { id: 'bookmarks', title: 'Bookmarks', icon: Bookmark },
  { id: 'attachments', title: 'Attachments', icon: Paperclip },
  { id: 'layers', title: 'Layers', icon: Layers },
];

function leftPanelCommands(): CommandDefinition[] {
  return LEFT_PANELS.map(({ id, title, icon }) => ({
    id: `view.show${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`,
    title,
    description: `Show ${title.toLowerCase()} in the left panel.`,
    category: 'view' as const,
    group: 'panels',
    icon,
    keywords: ['panel', 'sidebar', id],
    isChecked: (context) =>
      context.settings.layout.leftPanel.visible && context.settings.layout.activeLeftPanel === id,
    run: (context) => context.actions.setLeftPanel(id),
  }));
}

/**
 * Every command PaperForge can run today.
 *
 * Commands are added by the segment that makes them work — nothing here is a
 * placeholder, so a menu or palette entry always does what it says.
 */
export function buildCommands(): CommandDefinition[] {
  return [
    {
      id: 'file.open',
      title: 'Open…',
      description: 'Open one or more PDF files from this computer.',
      category: 'file',
      group: 'open',
      icon: FolderOpen,
      shortcut: 'Ctrl+O',
      keywords: ['file', 'browse', 'document'],
      run: (context) => context.actions.openDocuments(),
    },
    {
      id: 'file.openInNewWindow',
      title: 'New Window',
      description: 'Open another PaperForge window.',
      category: 'file',
      group: 'open',
      icon: AppWindow,
      keywords: ['window', 'second'],
      run: (context) => context.actions.openInNewWindow(),
    },
    {
      id: 'file.revealInExplorer',
      title: 'Show in Explorer',
      description: 'Open the folder containing the active document.',
      category: 'file',
      group: 'document',
      icon: FolderOpen,
      keywords: ['folder', 'location', 'reveal'],
      isAvailable: (context) =>
        context.activeDocument !== null ? true : { enabled: false, reason: 'No document is open.' },
      run: (context) => context.actions.revealActiveDocument(),
    },
    {
      id: 'file.closeDocument',
      title: 'Close Document',
      category: 'file',
      group: 'document',
      icon: SquareX,
      shortcut: 'Ctrl+W',
      keywords: ['tab', 'close'],
      isAvailable: (context) =>
        context.activeDocument !== null ? true : { enabled: false, reason: 'No document is open.' },
      run: (context) => context.actions.closeActiveDocument(),
    },
    {
      id: 'file.closeAllDocuments',
      title: 'Close All Documents',
      category: 'file',
      group: 'document',
      icon: SquareX,
      keywords: ['tabs', 'close everything'],
      isAvailable: (context) =>
        context.openDocumentCount > 0 ? true : { enabled: false, reason: 'No document is open.' },
      run: (context) => context.actions.closeAllDocuments(),
    },
    {
      id: 'window.close',
      title: 'Close Window',
      category: 'file',
      group: 'window',
      icon: AppWindow,
      shortcut: 'Ctrl+Shift+W',
      keywords: ['quit', 'exit'],
      run: (context) => context.actions.closeWindow(),
    },
    {
      id: 'view.toggleLeftPanel',
      title: 'Left Panel',
      description: 'Show or hide the navigation panel.',
      category: 'view',
      group: 'layout',
      icon: PanelLeft,
      keywords: ['sidebar', 'navigation'],
      isChecked: (context) => context.settings.layout.leftPanel.visible,
      run: (context) =>
        context.actions.patchSettings({
          layout: { leftPanel: { visible: !context.settings.layout.leftPanel.visible } },
        }),
    },
    {
      id: 'view.toggleRightPanel',
      title: 'Tools Panel',
      description: 'Show or hide the properties and tools panel.',
      category: 'view',
      group: 'layout',
      icon: PanelRight,
      shortcut: 'F4',
      keywords: ['properties', 'tools'],
      isChecked: (context) => context.settings.layout.rightPanel.visible,
      run: (context) =>
        context.actions.patchSettings({
          layout: { rightPanel: { visible: !context.settings.layout.rightPanel.visible } },
        }),
    },
    {
      id: 'view.toggleCommandBar',
      title: 'Command Bar',
      description: 'Show or hide the menu bar.',
      category: 'view',
      group: 'layout',
      icon: PanelTop,
      keywords: ['toolbar', 'menu'],
      isChecked: (context) => context.settings.layout.commandBarVisible,
      run: (context) =>
        context.actions.patchSettings({
          layout: { commandBarVisible: !context.settings.layout.commandBarVisible },
        }),
    },
    ...leftPanelCommands(),
    {
      id: 'view.toggleFullScreen',
      title: 'Full Screen',
      description: 'Fill the display with the workspace.',
      category: 'view',
      group: 'display',
      icon: Maximize2,
      shortcut: 'F11',
      keywords: ['reading mode', 'presentation'],
      isChecked: (context) => context.fullScreen,
      run: (context) => context.actions.toggleFullScreen(),
    },
    {
      id: 'view.cycleRegions',
      title: 'Next Region',
      description: 'Move focus to the next major region of the window.',
      category: 'view',
      group: 'display',
      icon: Keyboard,
      shortcut: 'F6',
      keywords: ['focus', 'accessibility', 'keyboard'],
      run: (context) => context.actions.focusNextRegion(),
    },
    {
      id: 'theme.setSystem',
      title: 'Appearance: Follow Windows',
      category: 'view',
      group: 'appearance',
      icon: Monitor,
      keywords: ['theme', 'dark', 'light', 'system'],
      isChecked: (context) => context.settings.appearance.theme === 'system',
      run: (context) => context.actions.setThemePreference('system'),
    },
    {
      id: 'theme.setLight',
      title: 'Appearance: Light',
      category: 'view',
      group: 'appearance',
      icon: Sun,
      keywords: ['theme'],
      isChecked: (context) => context.settings.appearance.theme === 'light',
      run: (context) => context.actions.setThemePreference('light'),
    },
    {
      id: 'theme.setDark',
      title: 'Appearance: Dark',
      category: 'view',
      group: 'appearance',
      icon: Moon,
      keywords: ['theme', 'night'],
      isChecked: (context) => context.settings.appearance.theme === 'dark',
      run: (context) => context.actions.setThemePreference('dark'),
    },

    {
      id: 'app.commandPalette',
      title: 'Command Palette',
      description: 'Search every available command.',
      category: 'tools',
      group: 'app',
      icon: Search,
      shortcut: 'Ctrl+K',
      keywords: ['search', 'run', 'actions'],
      hiddenInPalette: true,
      run: (context) => context.actions.setCommandPaletteOpen(true),
    },
    {
      id: 'app.openSettings',
      title: 'Settings',
      description: 'Open PaperForge settings.',
      category: 'tools',
      group: 'app',
      icon: SettingsIcon,
      shortcut: 'Ctrl+,',
      keywords: ['preferences', 'options'],
      run: (context) => context.actions.openDialog('settings'),
    },
    {
      id: 'app.toggleProgressCenter',
      title: 'Background Tasks',
      description: 'Show progress for long-running work.',
      category: 'tools',
      group: 'app',
      icon: Activity,
      keywords: ['jobs', 'progress', 'tasks'],
      run: (context) => context.actions.toggleProgressCenter(),
    },
    {
      id: 'privacy.clearRecentFiles',
      title: 'Clear Recent Files',
      description: 'Forget the list of recently opened files on this computer.',
      category: 'tools',
      group: 'privacy',
      icon: Eraser,
      keywords: ['privacy', 'history', 'forget'],
      isAvailable: (context) =>
        context.recentFiles.length > 0
          ? true
          : { enabled: false, reason: 'There are no recent files to clear.' },
      run: async (context) => {
        await context.actions.clearRecentFiles();
        context.actions.showToast({ title: 'Recent files cleared.', intent: 'success' });
      },
    },

    {
      id: 'help.about',
      title: 'About PaperForge',
      category: 'help',
      group: 'about',
      icon: Info,
      keywords: ['version', 'licenses'],
      run: (context) => context.actions.openDialog('about'),
    },
    {
      id: 'help.copyDiagnostics',
      title: 'Copy Diagnostics',
      description: 'Copy version and environment details to the clipboard.',
      category: 'help',
      group: 'about',
      icon: ClipboardCopy,
      keywords: ['support', 'environment', 'clipboard'],
      isAvailable: (context) =>
        context.appInfo !== null
          ? true
          : { enabled: false, reason: 'Environment details are still loading.' },
      run: (context) => context.actions.copyDiagnostics(),
    },
  ];
}

export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.registerAll(buildCommands());
  return registry;
}
