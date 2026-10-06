// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { CommandBar } from '../../../src/renderer/components/shell/CommandBar';
import { CommandPalette } from '../../../src/renderer/components/overlays/CommandPalette';
import { HomeScreen } from '../../../src/renderer/components/home/HomeScreen';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { installBridgeStub, renderWithCommands } from './testUtils';

beforeEach(() => {
  installBridgeStub({ 'settings:patch': { ok: true, data: DEFAULT_SETTINGS } });
});

describe('command bar', () => {
  it('only shows menus that have real commands', () => {
    renderWithCommands(<CommandBar />);
    const menuNames = screen
      .getAllByRole('menuitem', { expanded: false })
      .map((item) => item.textContent);

    // Window has no commands of its own yet, so it is not shown.
    expect(menuNames).toEqual(['File', 'Edit', 'View', 'Tools', 'Help']);
  });

  it('opens a menu and marks the active theme', async () => {
    renderWithCommands(<CommandBar />, {
      settings: { ...DEFAULT_SETTINGS, appearance: { theme: 'dark' } },
    });

    await userEvent.click(screen.getByRole('menuitem', { name: 'View' }));

    expect(screen.getByRole('menuitemcheckbox', { name: /Appearance: Dark/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: /Appearance: Light/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('shows the keyboard chord next to a command', async () => {
    renderWithCommands(<CommandBar />);
    await userEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('menuitemcheckbox', { name: /Tools Panel/ })).toHaveTextContent('F4');
  });

  it('disables a command that cannot run and explains why', async () => {
    renderWithCommands(<CommandBar />, { recentFiles: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tools' }));

    const clear = screen.getByRole('menuitem', { name: 'Clear Recent Files' });
    expect(clear).toBeDisabled();
    expect(clear).toHaveAttribute('title', 'There are no recent files to clear.');
  });

  it('enables the same command once there is something to clear', async () => {
    renderWithCommands(<CommandBar />, {
      recentFiles: [
        {
          path: 'C:/a.pdf',
          displayName: 'a.pdf',
          lastOpenedAt: '2026-01-01T00:00:00.000Z',
          pinned: false,
        },
      ],
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tools' }));
    expect(screen.getByRole('menuitem', { name: 'Clear Recent Files' })).toBeEnabled();
  });

  it('opens the command palette from the search button', async () => {
    renderWithCommands(<CommandBar />);
    await userEvent.click(screen.getByRole('button', { name: /Search commands/ }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });
});

describe('command palette', () => {
  it('lists commands and filters as you type', async () => {
    renderWithCommands(<CommandPalette />);
    const input = screen.getByRole('combobox', { name: '' });

    await userEvent.type(input, 'dark');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Appearance: Dark');
  });

  it('keeps unavailable commands visible with their reason', async () => {
    renderWithCommands(<CommandPalette />, { recentFiles: [] });
    await userEvent.type(screen.getByRole('combobox', { name: '' }), 'clear recent');

    const option = screen.getByRole('option', { name: /Clear Recent Files/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent('There are no recent files to clear.');
  });

  it('reports when nothing matches', async () => {
    renderWithCommands(<CommandPalette />);
    await userEvent.type(screen.getByRole('combobox', { name: '' }), 'zzzz');
    expect(screen.getByText('No matching commands.')).toBeInTheDocument();
  });
});

describe('home screen', () => {
  it('shows an honest empty state for recent files', () => {
    renderWithCommands(<HomeScreen recentFiles={[]} />);
    expect(screen.getByText('No recent files')).toBeInTheDocument();
  });

  it('lists recent entries with pinned ones marked', () => {
    renderWithCommands(
      <HomeScreen
        recentFiles={[
          {
            path: 'C:/Docs/Report.pdf',
            displayName: 'Report.pdf',
            lastOpenedAt: new Date().toISOString(),
            pinned: true,
          },
        ]}
      />,
    );

    expect(screen.getByText('Report.pdf')).toBeInTheDocument();
    expect(screen.getByText('C:/Docs/Report.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
  });

  it('offers to open a document for a tool that needs one, rather than greying it out', () => {
    renderWithCommands(<HomeScreen recentFiles={[]} />);

    // Each of these works on the document in front of the reader. With none
    // open, picking one asks for a document first.
    for (const name of [
      /Comment/,
      /Organize Pages/,
      /Edit PDF/,
      /Fill & Sign/,
      /Prepare Form/,
      /Protect PDF/,
      /Redact/,
      /Optimize PDF/,
      /Accessibility Check/,
    ]) {
      const tool = screen.getByRole('button', { name });
      expect(tool).toBeEnabled();
      expect(tool.getAttribute('title')).toMatch(/^Choose a PDF to open, then /);
    }
    expect(screen.getAllByText('Opens a PDF')).toHaveLength(13);
    // Making or combining documents needs none, so those carry no such note.
    expect(screen.getByRole('button', { name: /Combine Files/ })).not.toHaveTextContent(
      'Opens a PDF',
    );
  });
});
