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

  it('tells a tool that is not built apart from one that needs a document', () => {
    renderWithCommands(<HomeScreen recentFiles={[]} />);

    // Commenting exists; on the home screen there is simply nothing to mark up.
    const comment = screen.getByRole('button', { name: /Comment/ });
    expect(comment).toBeDisabled();
    expect(comment).toHaveAttribute('title', 'No document is open.');
    // Organizing pages is built too, and needs a document for the same reason.
    const organize = screen.getByRole('button', { name: /Organize Pages/ });
    expect(organize).toBeDisabled();
    expect(organize).toHaveAttribute('title', 'No document is open.');
    // Editing text is built as well, and needs one too.
    const editTool = screen.getByRole('button', { name: /Edit PDF/ });
    expect(editTool).toBeDisabled();
    expect(editTool).toHaveAttribute('title', 'No document is open.');
    // As do filling a form in and making one.
    const fillTool = screen.getByRole('button', { name: /Fill & Sign/ });
    expect(fillTool).toBeDisabled();
    expect(fillTool).toHaveAttribute('title', 'No document is open.');
    const prepareTool = screen.getByRole('button', { name: /Prepare Form/ });
    expect(prepareTool).toBeDisabled();
    // As do Recognize Text, Protect, Document Properties and removing hidden
    // information, all of which act on the document in front of the reader.
    const protectTool = screen.getByRole('button', { name: /Protect PDF/ });
    expect(protectTool).toBeDisabled();
    expect(protectTool).toHaveAttribute('title', 'No document is open.');
    // Redacting marks the document in front of the reader as well.
    const redactTool = screen.getByRole('button', { name: /Redact/ });
    expect(redactTool).toBeDisabled();
    expect(redactTool).toHaveAttribute('title', 'No document is open.');
    // And optimising makes the document in front of the reader smaller.
    expect(screen.getByRole('button', { name: /Optimize PDF/ })).toBeDisabled();
    expect(screen.getAllByText('Needs a document')).toHaveLength(12);

    // A tool whose capability is not built says something different.
    const accessibilityTool = screen.getByRole('button', { name: /Accessibility Check/ });
    expect(accessibilityTool).toBeDisabled();
    expect(accessibilityTool).toHaveAttribute(
      'title',
      expect.stringContaining('Not available yet'),
    );
    expect(screen.getAllByText('Not yet available').length).toBeGreaterThanOrEqual(1);
  });
});
