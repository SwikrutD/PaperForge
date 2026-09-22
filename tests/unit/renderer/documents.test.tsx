// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../../../src/shared/schemas/document';
import { DocumentProperties } from '../../../src/renderer/components/workspace/DocumentProperties';
import { FileDropZone } from '../../../src/renderer/components/shell/FileDropZone';
import { RecentFilesList } from '../../../src/renderer/components/home/RecentFilesList';
import { TabStrip } from '../../../src/renderer/components/shell/TabStrip';
import {
  DEFAULT_VIEW_STATE,
  mergeSessions,
  moveTab,
  nextActiveId,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { installBridgeStub, renderWithCommands } from './testUtils';

function session(
  id: string,
  name: string,
  overrides: Partial<DocumentSession> = {},
): DocumentSession {
  return {
    id,
    documentId: `doc-${id}`,
    file: {
      path: `C:/Docs/${name}`,
      displayName: name,
      sizeBytes: 2048,
      modifiedAt: '2026-09-21T10:00:00.000Z',
      readOnly: false,
      pdfVersion: '1.7',
      encryptionDetected: false,
    },
    openedAt: '2026-09-22T09:00:00.000Z',
    dirty: false,
    ...overrides,
  };
}

function tab(id: string, name: string, overrides: Partial<DocumentTab> = {}): DocumentTab {
  return {
    session: session(id, name),
    externalChange: null,
    view: { ...DEFAULT_VIEW_STATE },
    ...overrides,
  };
}

function seedTabs(tabs: DocumentTab[], activeId: string | null): void {
  useDocumentStore.setState({ tabs, activeId, busy: false });
}

beforeEach(() => {
  installBridgeStub();
  seedTabs([], null);
  useUiStore.setState({
    dialog: null,
    commandPaletteOpen: false,
    progressCenterOpen: false,
    toasts: [],
    confirmation: null,
  });
});

describe('tab helpers', () => {
  it('adds new sessions and refreshes ones already open', () => {
    const existing = [tab('a', 'a.pdf')];
    const merged = mergeSessions(existing, [
      session('a', 'a.pdf', { dirty: true }),
      session('b', 'b.pdf'),
    ]);

    expect(merged.map((entry) => entry.session.id)).toEqual(['a', 'b']);
    expect(merged[0]?.session.dirty).toBe(true);
  });

  it('activates the next tab when the active one closes', () => {
    const tabs = [tab('a', 'a.pdf'), tab('b', 'b.pdf'), tab('c', 'c.pdf')];
    expect(nextActiveId(tabs, 'b', 'b')).toBe('c');
    expect(nextActiveId(tabs, 'c', 'c')).toBe('b');
    expect(nextActiveId(tabs, 'a', 'b')).toBe('b');
    expect(nextActiveId([tab('a', 'a.pdf')], 'a', 'a')).toBeNull();
  });

  it('moves a tab and clamps out-of-range targets', () => {
    const tabs = [tab('a', 'a.pdf'), tab('b', 'b.pdf'), tab('c', 'c.pdf')];
    expect(moveTab(tabs, 'c', 0).map((entry) => entry.session.id)).toEqual(['c', 'a', 'b']);
    expect(moveTab(tabs, 'a', 99).map((entry) => entry.session.id)).toEqual(['b', 'c', 'a']);
    expect(moveTab(tabs, 'missing', 0).map((entry) => entry.session.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('document store', () => {
  it('turns per-file failures into error toasts', async () => {
    installBridgeStub({
      'files:openPaths': {
        ok: true,
        data: {
          sessions: [session('a', 'good.pdf')],
          failures: [
            { path: 'C:/Docs/notes.txt', code: 'pdf/invalid', message: 'That file is not a PDF.' },
          ],
          canceled: false,
        },
      },
    });

    await useDocumentStore.getState().openPaths(['C:/Docs/good.pdf', 'C:/Docs/notes.txt']);

    expect(useDocumentStore.getState().tabs.map((entry) => entry.session.id)).toEqual(['a']);
    expect(useUiStore.getState().toasts[0]).toMatchObject({
      title: 'That file is not a PDF.',
      intent: 'error',
    });
  });

  it('closes a clean document without asking', async () => {
    const bridge = installBridgeStub({ 'files:close': { ok: true, data: undefined } });
    seedTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf')], 'a');

    await useDocumentStore.getState().close('a');

    expect(bridge.invoke).toHaveBeenCalledWith('files:close', { sessionId: 'a' });
    expect(useDocumentStore.getState().tabs.map((entry) => entry.session.id)).toEqual(['b']);
    expect(useDocumentStore.getState().activeId).toBe('b');
    expect(useUiStore.getState().confirmation).toBeNull();
  });

  it('asks before closing a document with unsaved changes', async () => {
    const bridge = installBridgeStub({ 'files:close': { ok: true, data: undefined } });
    seedTabs([tab('a', 'a.pdf', { session: session('a', 'a.pdf', { dirty: true }) })], 'a');

    await useDocumentStore.getState().close('a');

    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmation).toMatchObject({
      title: 'Close a.pdf?',
      danger: true,
    });

    useUiStore.getState().resolveConfirmation(false);
    expect(useDocumentStore.getState().tabs).toHaveLength(1);

    await useDocumentStore.getState().close('a');
    useUiStore.getState().resolveConfirmation(true);
    await vi.waitFor(() => {
      expect(useDocumentStore.getState().tabs).toHaveLength(0);
    });
  });

  it('marks a tab when its file changes on disk', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    Object.defineProperty(window, 'paperforge', {
      configurable: true,
      value: {
        invoke: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
        subscribe: vi.fn((_channel: string, listener: (payload: unknown) => void) => {
          emit = listener;
          return () => undefined;
        }),
      },
    });

    await useDocumentStore.getState().initialize();
    seedTabs([tab('a', 'a.pdf')], 'a');

    emit?.({ sessionId: 'a', change: 'deleted', file: null });
    expect(useDocumentStore.getState().tabs[0]?.externalChange).toBe('deleted');

    useDocumentStore.getState().dismissChange('a');
    expect(useDocumentStore.getState().tabs[0]?.externalChange).toBeNull();
  });
});

describe('tab strip', () => {
  it('renders one tab per document and marks the active one', () => {
    seedTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf')], 'b');
    renderWithCommands(<TabStrip />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((element) => element.textContent)).toEqual(['a.pdf', 'b.pdf']);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows unsaved and changed-on-disk markers', () => {
    seedTabs(
      [
        tab('a', 'a.pdf', { session: session('a', 'a.pdf', { dirty: true }) }),
        tab('b', 'b.pdf', { externalChange: 'modified' }),
      ],
      'a',
    );
    renderWithCommands(<TabStrip />);

    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByLabelText('Changed on disk')).toBeInTheDocument();
  });

  it('activates a tab on click and closes one from its button', async () => {
    installBridgeStub({ 'files:close': { ok: true, data: undefined } });
    seedTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf')], 'a');
    renderWithCommands(<TabStrip />);

    await userEvent.click(screen.getByRole('tab', { name: 'b.pdf' }));
    expect(useDocumentStore.getState().activeId).toBe('b');

    await userEvent.click(screen.getByRole('button', { name: 'Close a.pdf' }));
    await vi.waitFor(() => {
      expect(useDocumentStore.getState().tabs.map((entry) => entry.session.id)).toEqual(['b']);
    });
  });

  it('offers tab actions in a context menu', async () => {
    seedTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf')], 'a');
    renderWithCommands(<TabStrip />);

    const firstTab = screen.getByRole('tab', { name: 'a.pdf' });
    // jsdom needs the event constructed explicitly.
    firstTab.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }),
    );

    const menu = await screen.findByRole('menu', { name: 'Tab actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Close others' })).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Move left' })).toBeDisabled();

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
    expect(useDocumentStore.getState().tabs.map((entry) => entry.session.id)).toEqual(['b', 'a']);
  });
});

describe('document properties', () => {
  it('shows the facts read from the file', () => {
    const current = tab('a', 'Rapport final.pdf');
    renderWithCommands(<DocumentProperties tab={current} />);

    expect(screen.getByText('C:/Docs/Rapport final.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('1.7')).toBeInTheDocument();
  });

  it('flags read-only and password-protected files', () => {
    const current: DocumentTab = {
      view: { ...DEFAULT_VIEW_STATE },
      session: session('a', 'locked.pdf', {
        file: {
          path: 'C:/Docs/locked.pdf',
          displayName: 'locked.pdf',
          sizeBytes: 10,
          modifiedAt: '2026-09-21T10:00:00.000Z',
          readOnly: true,
          pdfVersion: '1.6',
          encryptionDetected: true,
        },
      }),
      externalChange: null,
    };
    renderWithCommands(<DocumentProperties tab={current} />);

    expect(screen.getByText('Read-only file')).toBeInTheDocument();
    expect(screen.getByText('Password protected')).toBeInTheDocument();
  });

  it('warns when the file changed underneath the session', async () => {
    seedTabs([tab('a', 'a.pdf', { externalChange: 'modified' })], 'a');
    const current: DocumentTab = tab('a', 'a.pdf', { externalChange: 'modified' });
    renderWithCommands(<DocumentProperties tab={current} />);

    expect(screen.getByRole('alert')).toHaveTextContent('changed outside PaperForge');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useDocumentStore.getState().tabs[0]?.externalChange).toBeNull();
  });
});

describe('recent files', () => {
  const entry = {
    path: 'C:/Docs/Report.pdf',
    displayName: 'Report.pdf',
    lastOpenedAt: '2026-09-22T08:00:00.000Z',
    pinned: false,
    sizeBytes: 4096,
  };

  it('opens a file when its row is clicked', async () => {
    const bridge = installBridgeStub({
      'files:openPaths': { ok: true, data: { sessions: [], failures: [], canceled: false } },
    });
    renderWithCommands(<RecentFilesList entries={[entry]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open Report.pdf' }));
    expect(bridge.invoke).toHaveBeenCalledWith('files:openPaths', {
      paths: ['C:/Docs/Report.pdf'],
    });
  });

  it('pins and removes entries', async () => {
    const bridge = installBridgeStub({
      'recentFiles:setPinned': { ok: true, data: [{ ...entry, pinned: true }] },
      'recentFiles:remove': { ok: true, data: [] },
    });
    renderWithCommands(<RecentFilesList entries={[entry]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pin Report.pdf' }));
    expect(bridge.invoke).toHaveBeenCalledWith('recentFiles:setPinned', {
      path: entry.path,
      pinned: true,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Report.pdf from the list' }));
    expect(bridge.invoke).toHaveBeenCalledWith('recentFiles:remove', { path: entry.path });
  });
});

describe('drag and drop', () => {
  function dropFiles(element: Element, files: File[], paths: string[]): void {
    const bridge = window.paperforge as unknown as { getPathForFile: (file: File) => string };
    bridge.getPathForFile = (file) => paths[files.indexOf(file)] ?? '';

    const dataTransfer = {
      types: ['Files'],
      files,
      dropEffect: 'none',
    };
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    element.dispatchEvent(event);
  }

  it('opens the files that were dropped', async () => {
    const bridge = installBridgeStub({
      'files:openPaths': { ok: true, data: { sessions: [], failures: [], canceled: false } },
    });
    renderWithCommands(
      <FileDropZone>
        <p>workspace</p>
      </FileDropZone>,
    );

    const file = new File(['%PDF-1.7'], 'dropped.pdf', { type: 'application/pdf' });
    dropFiles(screen.getByText('workspace'), [file], ['C:/Docs/dropped.pdf']);

    await vi.waitFor(() => {
      expect(bridge.invoke).toHaveBeenCalledWith('files:openPaths', {
        paths: ['C:/Docs/dropped.pdf'],
      });
    });
  });

  it('explains when Windows gives no path instead of failing silently', () => {
    installBridgeStub();
    renderWithCommands(
      <FileDropZone>
        <p>workspace</p>
      </FileDropZone>,
    );

    const file = new File(['x'], 'mystery', { type: '' });
    dropFiles(screen.getByText('workspace'), [file], ['']);

    expect(useUiStore.getState().toasts[0]).toMatchObject({ intent: 'warning' });
  });
});
