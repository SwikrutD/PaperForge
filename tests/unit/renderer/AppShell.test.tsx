// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/schemas/settings';
import { AppShell } from '../../../src/renderer/components/shell/AppShell';
import { FOCUS_REGIONS } from '../../../src/renderer/types/ui';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { installBridgeStub, renderWithCommands } from './testUtils';

function settingsWith(layout: Partial<Settings['layout']>): Settings {
  return { ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, ...layout } };
}

function renderShell(
  settings: Settings = DEFAULT_SETTINGS,
  status: 'ready' | 'loading' = 'ready',
): void {
  renderWithCommands(
    <AppShell
      settings={settings}
      version="0.1.0"
      status={status}
      statusText={status === 'ready' ? 'Ready' : 'Loading settings…'}
      documentText={['No document open', 'Ctrl+O opens a PDF']}
      viewText={null}
    >
      <p>workspace content</p>
    </AppShell>,
    { settings },
  );
}

beforeEach(() => {
  installBridgeStub();
});

describe('AppShell layout', () => {
  it('renders the persisted panel layout', () => {
    renderShell(settingsWith({ leftPanel: { visible: true, width: 300 } }));

    expect(screen.getByRole('region', { name: 'Page Thumbnails' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Properties and tools' })).not.toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize the navigation panel' })).toHaveAttribute(
      'aria-valuenow',
      '300',
    );
  });

  it('hides the left panel and shows the right panel when settings say so', () => {
    renderShell(
      settingsWith({
        leftPanel: { visible: false, width: 264 },
        rightPanel: { visible: true, width: 320 },
      }),
    );

    expect(screen.queryByRole('region', { name: 'Page Thumbnails' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Properties and tools' })).toBeInTheDocument();
  });

  it('shows the panel chosen by activeLeftPanel', () => {
    renderShell(settingsWith({ activeLeftPanel: 'bookmarks' }));
    const panel = screen.getByRole('region', { name: 'Bookmarks' });
    // With no document open every navigation panel says so plainly.
    expect(within(panel).getByText('No document open')).toBeVisible();
    expect(
      within(panel).getByText('Open a PDF to see its pages, bookmarks, attachments and layers.'),
    ).toBeVisible();
  });

  it('reading mode leaves only the document and the title bar', async () => {
    renderShell();
    act(() => {
      useUiStore.getState().setReadingMode(true);
    });

    expect(screen.queryByRole('menubar', { name: 'Main menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Page Thumbnails' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Properties and tools' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();

    // Escape is the way back, since reading mode hides every control.
    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });
    expect(useUiStore.getState().readingMode).toBe(false);
    expect(screen.getByRole('menubar', { name: 'Main menu' })).toBeInTheDocument();
  });

  it('can hide the command bar', () => {
    renderShell();
    expect(screen.getByRole('menubar', { name: 'Main menu' })).toBeInTheDocument();

    renderShell(settingsWith({ commandBarVisible: false }));
    expect(screen.getAllByRole('menubar')).toHaveLength(1);
  });

  it('exposes every focus region for F6 navigation', () => {
    renderShell(
      settingsWith({
        leftPanel: { visible: true, width: 264 },
        rightPanel: { visible: true, width: 300 },
      }),
    );

    for (const region of FOCUS_REGIONS) {
      expect(document.querySelector(`[data-focus-region="${region}"]`)).not.toBeNull();
    }
  });

  it('resizes the navigation panel from the keyboard', async () => {
    const bridge = installBridgeStub({ 'settings:patch': { ok: true, data: DEFAULT_SETTINGS } });
    renderShell(settingsWith({ leftPanel: { visible: true, width: 264 } }));

    const separator = screen.getByRole('separator', { name: 'Resize the navigation panel' });
    separator.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(bridge.invoke).toHaveBeenCalledWith('settings:patch', {
      layout: { leftPanel: { width: 280 } },
    });
  });

  it('lists only the tools that can be used right now', async () => {
    renderShell(
      settingsWith({
        rightPanel: { visible: true, width: 300 },
        activeRightPanel: 'tools',
      }),
    );

    // Making a document needs no document, so these work from the start.
    expect(screen.getByRole('button', { name: /Create PDF/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Combine Files/ })).toBeEnabled();
    // Tools that need a document are absent until one is open.
    expect(screen.queryByRole('button', { name: /Organize Pages/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit PDF/ })).not.toBeInTheDocument();
    await Promise.resolve();
  });

  it('says what to do in the status bar, not the theme or "Ready"', () => {
    renderShell();
    const statusBar = within(screen.getByRole('contentinfo'));
    expect(statusBar.getByText('No document open')).toBeInTheDocument();
    expect(statusBar.getByText('Ctrl+O opens a PDF')).toBeInTheDocument();
    expect(statusBar.queryByText('Ready')).not.toBeInTheDocument();
    expect(statusBar.queryByText(/Theme/)).not.toBeInTheDocument();
  });

  it('shows startup status only while PaperForge is not ready', () => {
    renderShell(DEFAULT_SETTINGS, 'loading');
    expect(
      within(screen.getByRole('contentinfo')).getByText('Loading settings…'),
    ).toBeInTheDocument();
  });
});
