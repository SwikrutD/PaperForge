import { useCallback, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { AppError } from '@shared/errors/appError';
import type { LeftPanelId, RightPanelId } from '@shared/schemas/settings';
import { focusNextRegion } from '../keyboard/focusRegions';
import { buildShortcutTable, findShortcutCommand } from '../keyboard/shortcuts';
import { useAppStore } from '../stores/appStore';
import { useUiStore } from '../stores/uiStore';
import { buildDiagnosticsText } from '../utils/diagnostics';
import { CommandApiContext, type CommandApi } from './commandApiContext';
import { createCommandRegistry } from './definitions';
import type { CommandActions, CommandContext, ResolvedCommand } from './types';

export function CommandProvider({ children }: { children: ReactNode }): ReactElement {
  const registry = useMemo(() => createCommandRegistry(), []);

  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const appInfo = useAppStore((state) => state.appInfo);
  const recentFiles = useAppStore((state) => state.recentFiles);
  const windowState = useAppStore((state) => state.windowState);

  const showToast = useUiStore((state) => state.showToast);

  const actions = useMemo<CommandActions>(() => {
    const app = useAppStore.getState;
    const ui = useUiStore.getState;

    return {
      setThemePreference: (preference) => app().setThemePreference(preference),
      patchSettings: (patch) => app().patchSettings(patch),
      setLeftPanel: (panel: LeftPanelId) =>
        app().patchSettings({ layout: { activeLeftPanel: panel, leftPanel: { visible: true } } }),
      setRightPanel: (panel: RightPanelId) =>
        app().patchSettings({ layout: { activeRightPanel: panel, rightPanel: { visible: true } } }),
      toggleFullScreen: () => app().toggleFullScreen(),
      clearRecentFiles: () => app().clearRecentFiles(),
      openDialog: (dialog) => ui().openDialog(dialog),
      closeDialog: () => ui().closeDialog(),
      setCommandPaletteOpen: (open) => ui().setCommandPaletteOpen(open),
      toggleProgressCenter: () => ui().setProgressCenterOpen(!ui().progressCenterOpen),
      showToast: (toast) => void ui().showToast(toast),
      focusNextRegion: () => void focusNextRegion(),
      copyDiagnostics: async () => {
        const info = app().appInfo;
        if (info === null) return;
        await navigator.clipboard.writeText(buildDiagnosticsText(info));
        ui().showToast({ title: 'Diagnostics copied to the clipboard.', intent: 'success' });
      },
    };
  }, []);

  const context = useMemo<CommandContext | null>(() => {
    if (settings === null) return null;
    return {
      settings,
      theme,
      appInfo,
      recentFiles,
      documentOpen: false,
      fullScreen: windowState?.fullScreen ?? false,
      actions,
    };
  }, [settings, theme, appInfo, recentFiles, windowState, actions]);

  const execute = useCallback(
    (id: string) => {
      if (context === null) return;
      void registry.execute(id, context).catch((error: unknown) => {
        const serialized = AppError.serialize(error);
        showToast({
          title: serialized.message,
          description: serialized.details,
          intent: 'error',
        });
      });
    },
    [context, registry, showToast],
  );

  const resolve = useCallback(
    (id: string): ResolvedCommand | undefined => {
      const definition = registry.get(id);
      if (definition === undefined) return undefined;
      if (context === null) {
        return {
          definition,
          enabled: false,
          reason: 'PaperForge is still starting.',
          checked: false,
        };
      }
      return registry.resolve(id, context);
    },
    [context, registry],
  );

  const resolveAll = useCallback((): ResolvedCommand[] => {
    if (context === null) {
      return registry
        .list()
        .map((definition) => ({ definition, enabled: false, reason: undefined, checked: false }));
    }
    return registry.resolveAll(context);
  }, [context, registry]);

  // One global key handler for every shortcut in the registry.
  const shortcuts = useMemo(() => buildShortcutTable(registry.list()), [registry]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return;
      const commandId = findShortcutCommand(event, shortcuts);
      if (commandId === undefined) return;
      event.preventDefault();
      execute(commandId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, execute]);

  const api = useMemo<CommandApi>(
    () => ({ registry, context, execute, resolve, resolveAll }),
    [registry, context, execute, resolve, resolveAll],
  );

  return <CommandApiContext.Provider value={api}>{children}</CommandApiContext.Provider>;
}
