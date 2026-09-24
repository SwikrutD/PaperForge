import { useCallback, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { AppError } from '@shared/errors/appError';
import { invoke } from '../services/ipcClient';
import type { LeftPanelId, RightPanelId } from '@shared/schemas/settings';
import { nextZoomStep, type ZoomMode } from '../components/viewer/viewerLayout';
import { describeOperation } from '@pdf/mutate/operations';
import type { RotationDegrees } from '@shared/schemas/edit';
import { focusNextRegion } from '../keyboard/focusRegions';
import { buildShortcutTable, findShortcutCommand } from '../keyboard/shortcuts';
import { useAppStore } from '../stores/appStore';
import { useDocumentStore } from '../stores/documentStore';
import { useAnnotationStore } from '../stores/annotationStore';
import { useCreateStore } from '../stores/createStore';
import { useTextEditStore } from '../stores/textEditStore';
import { useFormStore } from '../stores/formStore';
import { useOrganizeStore } from '../stores/organizeStore';
import { useSearchStore } from '../stores/searchStore';
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
  const tabs = useDocumentStore((state) => state.tabs);
  const activeTabId = useDocumentStore((state) => state.activeId);
  const readingMode = useUiStore((state) => state.readingMode);
  const commenting = useUiStore((state) => state.commenting);
  const organizing = useOrganizeStore((state) => state.active);
  const creating = useCreateStore((state) => state.open);
  const editingText = useTextEditStore((state) => state.active);
  const filling = useFormStore((state) => state.active);
  const preparingForm = useFormStore((state) => state.preparing);
  const annotationTool = useAnnotationStore((state) => state.tool);
  const annotationSelected = useAnnotationStore((state) => state.selectedId !== null);
  const findOpen = useSearchStore((state) => state.open);
  const matchCount = useSearchStore((state) => state.results.hits.length);

  const showToast = useUiStore((state) => state.showToast);

  const actions = useMemo<CommandActions>(() => {
    const app = useAppStore.getState;
    const ui = useUiStore.getState;
    const documents = useDocumentStore.getState;
    const search = useSearchStore.getState;
    const annotations = useAnnotationStore.getState;
    const organize = useOrganizeStore.getState;
    const creation = useCreateStore.getState;
    const textEditor = useTextEditStore.getState;
    const forms = useFormStore.getState;

    const activeSessionId = (): string | null => documents().activeId;

    return {
      openDocuments: () => documents().openWithDialog(),
      openInNewWindow: () => void invoke('window:openNew'),
      closeActiveDocument: async () => {
        const id = activeSessionId();
        if (id !== null) await documents().close(id);
      },
      closeAllDocuments: () => documents().closeAll(),
      revealActiveDocument: async () => {
        const id = activeSessionId();
        const tab = documents().tabs.find((candidate) => candidate.session.id === id);
        if (tab === undefined) return;
        await invoke('files:revealInExplorer', { path: tab.session.file.path });
      },
      closeWindow: () => invoke('window:close'),

      setZoomMode: (mode: ZoomMode) => {
        const id = activeSessionId();
        if (id !== null) documents().updateView(id, { zoomMode: mode });
      },
      zoomBy: (direction) => {
        const id = activeSessionId();
        const current = documents().tabs.find((tab) => tab.session.id === id);
        if (id === null || current === undefined) return;
        documents().updateView(id, {
          zoomMode: 'custom',
          scale: nextZoomStep(current.view.scale, direction),
        });
      },
      rotateView: (direction) => {
        const id = activeSessionId();
        const current = documents().tabs.find((tab) => tab.session.id === id);
        if (id === null || current === undefined) return;
        const next = (((current.view.rotation + direction * 90) % 360) + 360) % 360;
        documents().updateView(id, { rotation: next as 0 | 90 | 180 | 270 });
      },
      goToPage: (pageNumber) => {
        const id = activeSessionId();
        if (id !== null) documents().updateView(id, { pendingPage: pageNumber });
      },
      rotateCurrentPage: (direction) => {
        const id = activeSessionId();
        const current = documents().tabs.find((tab) => tab.session.id === id);
        if (id === null || current === undefined) return;
        const degrees: RotationDegrees = direction === 1 ? 90 : 270;
        const operation = {
          kind: 'rotatePages' as const,
          pages: [current.view.pageNumber],
          degrees,
        };
        void documents().applyEdit(id, {
          label: describeOperation(operation),
          operations: [operation],
        });
      },
      deleteCurrentPage: () => {
        const id = activeSessionId();
        const current = documents().tabs.find((tab) => tab.session.id === id);
        if (id === null || current === undefined) return;
        const operation = { kind: 'deletePages' as const, pages: [current.view.pageNumber] };
        void documents().applyEdit(id, {
          label: describeOperation(operation),
          operations: [operation],
        });
      },
      undo: () => {
        const id = activeSessionId();
        if (id !== null) void documents().undo(id);
      },
      redo: () => {
        const id = activeSessionId();
        if (id !== null) void documents().redo(id);
      },
      revert: () => {
        const id = activeSessionId();
        if (id !== null) void documents().revert(id);
      },
      saveDocument: (mode) => {
        const id = activeSessionId();
        if (id !== null) void documents().save(id, mode);
      },
      goToRelativePage: (offset) => {
        const id = activeSessionId();
        const current = documents().tabs.find((tab) => tab.session.id === id);
        if (id === null || current === undefined) return;
        documents().updateView(id, { pendingPage: current.view.pageNumber + offset });
      },
      openFind: (options) => search().openFind(options),
      closeFind: () => search().closeFind(),
      findNext: () => search().nextMatch(),
      findPrevious: () => search().previousMatch(),
      setThemePreference: (preference) => app().setThemePreference(preference),
      patchSettings: (patch) => app().patchSettings(patch),
      setLeftPanel: (panel: LeftPanelId) =>
        app().patchSettings({ layout: { activeLeftPanel: panel, leftPanel: { visible: true } } }),
      setRightPanel: (panel: RightPanelId) =>
        app().patchSettings({ layout: { activeRightPanel: panel, rightPanel: { visible: true } } }),
      toggleFullScreen: () => app().toggleFullScreen(),
      toggleReadingMode: () => ui().setReadingMode(!ui().readingMode),
      toggleCommenting: () => {
        const next = !ui().commenting;
        ui().setCommenting(next);
        if (!next) annotations().setTool('select');
        else void app().patchSettings({ layout: { rightPanel: { visible: true } } });
      },
      toggleOrganizing: () => {
        const next = !organize().active;
        organize().setActive(next);
        // The page grid is its own way of working: comment tools would have
        // nothing to act on there, and the properties panel becomes the place
        // where a page says what it is.
        if (next) {
          ui().setCommenting(false);
          void app().patchSettings({
            layout: { activeRightPanel: 'properties', rightPanel: { visible: true } },
          });
        }
      },
      toggleTextEditing: () => {
        const next = !textEditor().active;
        // Editing text and marking it up are different jobs; one at a time.
        if (next) {
          ui().setCommenting(false);
          annotations().setTool('select');
          organize().setActive(false);
          void app().patchSettings({
            layout: { activeRightPanel: 'properties', rightPanel: { visible: true } },
          });
        }
        textEditor().setActive(next);
        if (next) forms().setActive(false);
      },
      toggleFilling: () => {
        const next = !forms().active;
        // Filling a form in is its own way of working: the comment tools and
        // the content editor have nothing to act on while it is open.
        if (next) {
          ui().setCommenting(false);
          annotations().setTool('select');
          organize().setActive(false);
          textEditor().setActive(false);
          void app().patchSettings({
            layout: { activeRightPanel: 'properties', rightPanel: { visible: true } },
          });
        } else {
          void forms().commitDrafts();
        }
        forms().setActive(next);
      },
      togglePreparingForm: () => {
        const next = !forms().preparing;
        if (next) {
          ui().setCommenting(false);
          annotations().setTool('select');
          organize().setActive(false);
          textEditor().setActive(false);
          void app().patchSettings({
            layout: { activeRightPanel: 'properties', rightPanel: { visible: true } },
          });
          forms().setActive(true);
        }
        forms().setPreparing(next);
      },
      openCreateWorkspace: (intent) => {
        // Making a document is its own workspace: the page grid has nothing to
        // act on while it is open.
        organize().setActive(false);
        creation().openWorkspace(intent);
      },
      closeCreateWorkspace: () => creation().closeWorkspace(),
      setAnnotationTool: (tool) => {
        ui().setCommenting(true);
        annotations().setTool(tool);
      },
      deleteSelectedAnnotation: () => {
        const id = annotations().selectedId;
        if (id !== null) void annotations().remove([id]);
      },
      toggleSelectedAnnotationResolved: () => {
        const state = annotations();
        const selected = state.annotations.find((entry) => entry.id === state.selectedId);
        if (selected === undefined) return;
        void state.update(
          selected.id,
          { resolved: !selected.resolved },
          selected.resolved ? 'Reopen comment' : 'Mark comment done',
        );
      },
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
      activeDocument: tabs.find((tab) => tab.session.id === activeTabId)?.session ?? null,
      activeView: tabs.find((tab) => tab.session.id === activeTabId)?.view ?? null,
      activeEdit: tabs.find((tab) => tab.session.id === activeTabId)?.edit ?? null,
      activePageCount: tabs.find((tab) => tab.session.id === activeTabId)?.pageCount ?? 0,
      openDocumentCount: tabs.length,
      fullScreen: windowState?.fullScreen ?? false,
      readingMode,
      commenting,
      organizing,
      creating,
      editingText,
      filling,
      preparingForm,
      annotationTool: annotationTool === 'select' ? null : annotationTool,
      annotationSelected,
      findOpen,
      matchCount,
      actions,
    };
  }, [
    settings,
    theme,
    appInfo,
    recentFiles,
    windowState,
    tabs,
    activeTabId,
    readingMode,
    commenting,
    organizing,
    creating,
    editingText,
    filling,
    preparingForm,
    annotationTool,
    annotationSelected,
    findOpen,
    matchCount,
    actions,
  ]);

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
