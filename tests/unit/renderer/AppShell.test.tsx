// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/schemas/settings';
import { AppShell } from '../../../src/renderer/components/shell/AppShell';
import { FOCUS_REGIONS } from '../../../src/renderer/types/ui';
import { installBridgeStub, renderWithCommands } from './testUtils';

function settingsWith(layout: Partial<Settings['layout']>): Settings {
  return { ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, ...layout } };
}

function renderShell(settings: Settings = DEFAULT_SETTINGS): void {
  renderWithCommands(
    <AppShell
      settings={settings}
      version="0.1.0"
      status="ready"
      statusText="Ready"
      themeText="Theme: light (system)"
      documentText="No document open"
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
    expect(screen.getByRole('region', { name: 'Bookmarks' })).toBeInTheDocument();
    expect(screen.getByText("A document's outline appears here when it has one.")).toBeVisible();
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

  it('shows an honest empty state in the tools panel while no tool is available', async () => {
    renderShell(
      settingsWith({
        rightPanel: { visible: true, width: 300 },
        activeRightPanel: 'tools',
      }),
    );

    expect(screen.getByText('No tools available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit PDF/ })).not.toBeInTheDocument();
    await Promise.resolve();
  });

  it('reports status and theme in the status bar', () => {
    renderShell();
    const statusBar = within(screen.getByRole('contentinfo'));
    expect(statusBar.getByText('Ready')).toBeInTheDocument();
    expect(statusBar.getByText('No document open')).toBeInTheDocument();
    expect(statusBar.getByText('Theme: light (system)')).toBeInTheDocument();
  });
});
