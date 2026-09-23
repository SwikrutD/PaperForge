import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/shared/errors/appError';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { CommandRegistry } from '../../../src/renderer/commands/registry';
import type { CommandContext, CommandDefinition } from '../../../src/renderer/commands/types';

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    settings: DEFAULT_SETTINGS,
    theme: { preference: 'system', resolved: 'light' },
    appInfo: null,
    recentFiles: [],
    activeDocument: null,
    activeView: null,
    activeEdit: null,
    activePageCount: 0,
    openDocumentCount: 0,
    fullScreen: false,
    readingMode: false,
    commenting: false,
    organizing: false,
    annotationTool: null,
    annotationSelected: false,
    findOpen: false,
    matchCount: 0,
    actions: {} as CommandContext['actions'],
    ...overrides,
  };
}

function command(overrides: Partial<CommandDefinition> & { id: string }): CommandDefinition {
  return {
    title: overrides.id,
    category: 'view',
    run: vi.fn(),
    ...overrides,
  };
}

describe('CommandRegistry', () => {
  it('keeps registration order and looks commands up by id', () => {
    const registry = new CommandRegistry();
    registry.registerAll([command({ id: 'a' }), command({ id: 'b' })]);

    expect(registry.list().map((definition) => definition.id)).toEqual(['a', 'b']);
    expect(registry.get('b')?.id).toBe('b');
    expect(registry.has('missing')).toBe(false);
  });

  it('refuses duplicate ids and duplicate shortcuts', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'a', shortcut: 'Ctrl+K' }));

    expect(() => registry.register(command({ id: 'a' }))).toThrow(/already registered/);
    expect(() => registry.register(command({ id: 'b', shortcut: 'Ctrl+K' }))).toThrow(
      /claimed by both/,
    );
  });

  it('treats a command with no rule as always available', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'a' }));

    expect(registry.resolve('a', makeContext())).toMatchObject({ enabled: true, checked: false });
  });

  it('reports why a command is disabled', () => {
    const registry = new CommandRegistry();
    registry.register(
      command({
        id: 'privacy.clearRecentFiles',
        isAvailable: (context) =>
          context.recentFiles.length > 0
            ? true
            : { enabled: false, reason: 'There are no recent files to clear.' },
      }),
    );

    const empty = registry.resolve('privacy.clearRecentFiles', makeContext());
    expect(empty).toMatchObject({ enabled: false, reason: 'There are no recent files to clear.' });

    const withFiles = registry.resolve(
      'privacy.clearRecentFiles',
      makeContext({
        recentFiles: [
          { path: 'C:/a.pdf', displayName: 'a.pdf', lastOpenedAt: '2026-01-01', pinned: false },
        ],
      }),
    );
    expect(withFiles?.enabled).toBe(true);
  });

  it('reports checked state for toggles', () => {
    const registry = new CommandRegistry();
    registry.register(
      command({
        id: 'theme.setDark',
        isChecked: (context) => context.settings.appearance.theme === 'dark',
      }),
    );

    expect(registry.resolve('theme.setDark', makeContext())?.checked).toBe(false);
    const darkContext = makeContext({
      settings: { ...DEFAULT_SETTINGS, appearance: { theme: 'dark' } },
    });
    expect(registry.resolve('theme.setDark', darkContext)?.checked).toBe(true);
  });

  it('runs an available command', async () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register(command({ id: 'a', run }));

    await registry.execute('a', makeContext());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses to run a disabled or unknown command', async () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register(
      command({ id: 'a', run, isAvailable: () => ({ enabled: false, reason: 'Nope.' }) }),
    );

    await expect(registry.execute('a', makeContext())).rejects.toBeInstanceOf(AppError);
    await expect(registry.execute('missing', makeContext())).rejects.toMatchObject({
      code: 'internal/unexpected',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves every command in one pass for menus and the palette', () => {
    const registry = new CommandRegistry();
    registry.registerAll([
      command({ id: 'a', category: 'view' }),
      command({ id: 'b', category: 'help', isAvailable: () => false }),
    ]);

    const resolved = registry.resolveAll(makeContext());
    expect(resolved.map((entry) => [entry.definition.id, entry.enabled])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(registry.listByCategory('help').map((definition) => definition.id)).toEqual(['b']);
  });
});
