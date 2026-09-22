// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { useAppStore } from '../../../src/renderer/stores/appStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { useJobStore } from '../../../src/renderer/stores/jobStore';
import { filterCommands } from '../../../src/renderer/commands/filterCommands';
import { focusNextRegion, nextRegionElement } from '../../../src/renderer/keyboard/focusRegions';
import { formatRelativeTime } from '../../../src/renderer/utils/time';
import type { ResolvedCommand } from '../../../src/renderer/commands/types';

const THEME_STATE = { preference: 'system', resolved: 'light' } as const;
const WINDOW_STATE = { fullScreen: false, maximized: false, focused: true };
const APP_INFO = {
  name: 'PaperForge',
  version: '0.1.0',
  isPackaged: false,
  platform: 'win32',
  arch: 'x64',
  locale: 'en-US',
  versions: { electron: '44.0.0', chrome: '140.0.0', node: '22.0.0', v8: '14.0' },
  paths: { userData: 'C:/u', logs: 'C:/l', temp: 'C:/t' },
};

function installBridge(responses: Record<string, unknown>): void {
  Object.defineProperty(window, 'paperforge', {
    configurable: true,
    value: {
      invoke: vi.fn((channel: string) => Promise.resolve(responses[channel])),
      subscribe: vi.fn(() => () => undefined),
    },
  });
}

const READY_RESPONSES = {
  'settings:get': { ok: true, data: DEFAULT_SETTINGS },
  'theme:getState': { ok: true, data: THEME_STATE },
  'app:getInfo': { ok: true, data: APP_INFO },
  'recentFiles:list': { ok: true, data: [] },
  'window:getState': { ok: true, data: WINDOW_STATE },
};

beforeEach(() => {
  useAppStore.setState({
    status: 'idle',
    settings: null,
    theme: null,
    appInfo: null,
    recentFiles: [],
    windowState: null,
    error: null,
  });
  useUiStore.setState({
    dialog: null,
    commandPaletteOpen: false,
    progressCenterOpen: false,
    toasts: [],
  });
  useJobStore.setState({ jobs: [], cancelHandlers: {} });
});

describe('app store', () => {
  it('loads settings, theme, environment, recent files and window state', async () => {
    installBridge(READY_RESPONSES);
    await useAppStore.getState().initialize();

    const state = useAppStore.getState();
    expect(state.status).toBe('ready');
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
    expect(state.windowState).toEqual(WINDOW_STATE);
    expect(state.recentFiles).toEqual([]);
  });

  it('records a typed error instead of throwing when startup fails', async () => {
    installBridge({
      ...READY_RESPONSES,
      'settings:get': { ok: false, error: { code: 'settings/invalid', message: 'Bad settings.' } },
    });
    await useAppStore.getState().initialize();

    expect(useAppStore.getState().status).toBe('error');
    expect(useAppStore.getState().error).toMatchObject({ code: 'settings/invalid' });
  });

  it('keeps the previous settings when a patch is rejected', async () => {
    installBridge({
      ...READY_RESPONSES,
      'settings:patch': { ok: false, error: { code: 'io/write-failed', message: 'No.' } },
    });
    await useAppStore.getState().initialize();
    await expect(
      useAppStore.getState().patchSettings({ layout: { leftPanel: { visible: false } } }),
    ).rejects.toBeDefined();

    expect(useAppStore.getState().settings?.layout.leftPanel.visible).toBe(true);
  });

  it('applies a full-screen toggle from the main process', async () => {
    installBridge({
      ...READY_RESPONSES,
      'window:toggleFullScreen': { ok: true, data: { ...WINDOW_STATE, fullScreen: true } },
    });
    await useAppStore.getState().initialize();
    await useAppStore.getState().toggleFullScreen();

    expect(useAppStore.getState().windowState?.fullScreen).toBe(true);
  });
});

describe('ui store', () => {
  it('auto-dismisses ordinary toasts but keeps errors until dismissed', () => {
    const infoId = useUiStore.getState().showToast({ title: 'Saved' });
    const errorId = useUiStore.getState().showToast({ title: 'Failed', intent: 'error' });

    const [info, failure] = useUiStore.getState().toasts;
    expect(info?.durationMs).toBe(4000);
    expect(failure?.durationMs).toBeUndefined();

    useUiStore.getState().dismissToast(infoId);
    expect(useUiStore.getState().toasts.map((toast) => toast.id)).toEqual([errorId]);
  });

  it('closes the palette when a dialog opens', () => {
    useUiStore.getState().setCommandPaletteOpen(true);
    useUiStore.getState().openDialog('settings');

    expect(useUiStore.getState()).toMatchObject({ dialog: 'settings', commandPaletteOpen: false });
  });
});

describe('job store', () => {
  it('tracks progress and completion', () => {
    const id = useJobStore
      .getState()
      .start({ type: 'ocr', title: 'Recognize text', totalItems: 4 });
    useJobStore.getState().progress(id, { completedItems: 2, currentItem: 'Page 2 of 4' });

    const running = useJobStore.getState().jobs[0];
    expect(running).toMatchObject({
      state: 'running',
      completedItems: 2,
      currentItem: 'Page 2 of 4',
    });

    useJobStore.getState().succeed(id, 'C:/out.pdf');
    expect(useJobStore.getState().jobs[0]).toMatchObject({
      state: 'succeeded',
      resultPath: 'C:/out.pdf',
    });
  });

  it('runs the cancel handler and marks the job cancelled', () => {
    const onCancel = vi.fn();
    const id = useJobStore.getState().start({ type: 'export', title: 'Export pages' }, onCancel);

    useJobStore.getState().cancel(id);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useJobStore.getState().jobs[0]?.state).toBe('cancelled');

    useJobStore.getState().cancel(id);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clears finished jobs but keeps running ones', () => {
    const finished = useJobStore.getState().start({ type: 'save', title: 'Save' });
    useJobStore.getState().start({ type: 'compare', title: 'Compare' });
    useJobStore.getState().fail(finished, 'Disk full');

    useJobStore.getState().dismissFinished();
    expect(useJobStore.getState().jobs.map((job) => job.title)).toEqual(['Compare']);
  });
});

describe('command palette filtering', () => {
  const entry = (
    id: string,
    title: string,
    extra: Partial<ResolvedCommand['definition']> = {},
  ): ResolvedCommand => ({
    definition: { id, title, category: 'view', run: () => undefined, ...extra },
    enabled: true,
    reason: undefined,
    checked: false,
  });

  const commands = [
    entry('a', 'Left Panel'),
    entry('b', 'Appearance: Dark', { keywords: ['theme', 'night'] }),
    entry('c', 'Background Tasks', { description: 'Show progress for long-running work.' }),
    entry('d', 'Command Palette', { hiddenInPalette: true }),
  ];

  it('hides commands marked as internal', () => {
    expect(filterCommands(commands, '').map((item) => item.definition.id)).toEqual(['a', 'b', 'c']);
  });

  it('ranks a title prefix above a keyword or description match', () => {
    expect(filterCommands(commands, 'a').map((item) => item.definition.id)[0]).toBe('b');
    expect(filterCommands(commands, 'night').map((item) => item.definition.id)).toEqual(['b']);
    expect(filterCommands(commands, 'progress').map((item) => item.definition.id)).toEqual(['c']);
  });

  it('returns nothing when there is no match', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});

describe('focus regions', () => {
  it('cycles through the regions present in the document', () => {
    document.body.innerHTML = `
      <div data-focus-region="commandBar" tabindex="-1"></div>
      <div data-focus-region="workspace" tabindex="-1"><button>inside</button></div>
      <div data-focus-region="statusBar" tabindex="-1"></div>
    `;

    expect(focusNextRegion(document)).toBe('commandBar');
    expect(focusNextRegion(document)).toBe('workspace');
    expect(focusNextRegion(document)).toBe('statusBar');
    expect(focusNextRegion(document)).toBe('commandBar');
  });

  it('moves on from whichever region currently holds focus', () => {
    document.body.innerHTML = `
      <div data-focus-region="workspace" tabindex="-1"><button id="inner">inside</button></div>
      <div data-focus-region="statusBar" tabindex="-1"></div>
    `;
    document.getElementById('inner')?.focus();

    const regions = [...document.querySelectorAll<HTMLElement>('[data-focus-region]')];
    expect(nextRegionElement(regions, document.activeElement)?.dataset['focusRegion']).toBe(
      'statusBar',
    );
  });
});

describe('relative time', () => {
  const now = new Date('2026-09-22T12:00:00.000Z');

  it('describes recent timestamps in words', () => {
    expect(formatRelativeTime('2026-09-22T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-09-22T09:00:00.000Z', now)).toContain('hours ago');
    expect(formatRelativeTime('2026-09-20T12:00:00.000Z', now)).toContain('days ago');
  });

  it('returns the original value when it cannot be parsed', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
  });
});
