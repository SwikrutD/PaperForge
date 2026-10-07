// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/schemas/settings';
import { SettingsDialog } from '../../../src/renderer/components/overlays/SettingsDialog';
import { installBridgeStub, renderWithCommands } from './testUtils';

/** The menu bar is shown and hidden from Settings > General, and nowhere else. */

function withMenuBar(menuBarVisible: boolean): Settings {
  return { ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, menuBarVisible } };
}

let bridge: ReturnType<typeof installBridgeStub>;

beforeEach(() => {
  bridge = installBridgeStub({
    'settings:patch': { ok: true, data: DEFAULT_SETTINGS },
    'signatures:list': { ok: true, data: [] },
  });
});

describe('Show menu bar, in Settings > General', () => {
  it('is on by default', () => {
    renderWithCommands(<SettingsDialog settings={DEFAULT_SETTINGS} />);
    const general = screen.getByRole('region', { name: 'General' });
    expect(general).toContainElement(screen.getByRole('checkbox', { name: 'Show menu bar' }));
    expect(screen.getByRole('checkbox', { name: 'Show menu bar' })).toBeChecked();
  });

  it('hides the menu bar when turned off', async () => {
    renderWithCommands(<SettingsDialog settings={withMenuBar(true)} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show menu bar' }));
    expect(bridge.invoke).toHaveBeenCalledWith('settings:patch', {
      layout: { menuBarVisible: false },
    });
  });

  it('shows it again when turned on', async () => {
    renderWithCommands(<SettingsDialog settings={withMenuBar(false)} />);
    expect(screen.getByRole('checkbox', { name: 'Show menu bar' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show menu bar' }));
    expect(bridge.invoke).toHaveBeenCalledWith('settings:patch', {
      layout: { menuBarVisible: true },
    });
  });
});
