// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildShortcutTable,
  findShortcutCommand,
  formatShortcut,
  isTypingTarget,
  matchesShortcut,
  parseShortcut,
} from '../../../src/renderer/keyboard/shortcuts';

function keyEvent(init: KeyboardEventInit & { target?: EventTarget }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', init);
  if (init.target !== undefined) {
    Object.defineProperty(event, 'target', { value: init.target, configurable: true });
  }
  return event;
}

describe('parseShortcut', () => {
  it('parses modifier chords', () => {
    expect(parseShortcut('Ctrl+K')).toEqual({
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
      key: 'k',
    });
    expect(parseShortcut('Ctrl+Shift+P')).toMatchObject({ ctrl: true, shift: true, key: 'p' });
    expect(parseShortcut('Alt+Enter')).toMatchObject({ alt: true, key: 'Enter' });
  });

  it('parses function and named keys', () => {
    expect(parseShortcut('F11')).toMatchObject({ key: 'F11', ctrl: false });
    expect(parseShortcut('PageDown')).toMatchObject({ key: 'PageDown' });
    expect(parseShortcut('Ctrl+Plus')).toMatchObject({ ctrl: true, key: '+' });
  });

  it('rejects malformed chords', () => {
    expect(parseShortcut('')).toBeNull();
    expect(parseShortcut('Ctrl')).toBeNull();
    expect(parseShortcut('Ctrl+')).toBeNull();
    expect(parseShortcut('Ctrl+K+J')).toBeNull();
  });

  it('formats chords in Windows order', () => {
    expect(formatShortcut('shift+ctrl+p')).toBe('Ctrl+Shift+P');
    expect(formatShortcut('f4')).toBe('F4');
  });
});

describe('matchesShortcut', () => {
  it('matches only the exact modifier combination', () => {
    expect(matchesShortcut(keyEvent({ key: 'k', ctrlKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'K', ctrlKey: true, shiftKey: true }), 'Ctrl+K')).toBe(
      false,
    );
    expect(matchesShortcut(keyEvent({ key: 'k' }), 'Ctrl+K')).toBe(false);
  });

  it('is case-insensitive about the reported key', () => {
    expect(matchesShortcut(keyEvent({ key: 'K', ctrlKey: true }), 'ctrl+k')).toBe(true);
  });
});

describe('shortcut dispatch', () => {
  const table = buildShortcutTable([
    { id: 'app.commandPalette', shortcut: 'Ctrl+K' },
    { id: 'view.toggleRightPanel', shortcut: 'F4' },
    { id: 'view.cycleRegions', shortcut: 'F6' },
    { id: 'view.noShortcut' },
  ]);

  it('only includes commands that declare a chord', () => {
    expect(table.map((entry) => entry.commandId)).toEqual([
      'app.commandPalette',
      'view.toggleRightPanel',
      'view.cycleRegions',
    ]);
  });

  it('finds the command for a key press', () => {
    expect(findShortcutCommand(keyEvent({ key: 'k', ctrlKey: true }), table)).toBe(
      'app.commandPalette',
    );
    expect(findShortcutCommand(keyEvent({ key: 'F4' }), table)).toBe('view.toggleRightPanel');
    expect(findShortcutCommand(keyEvent({ key: 'q' }), table)).toBeUndefined();
  });

  it('lets modifier chords and function keys through while typing', () => {
    const input = document.createElement('input');
    // A function key types nothing, so it still reaches the application.
    expect(findShortcutCommand(keyEvent({ key: 'F4', target: input }), table)).toBe(
      'view.toggleRightPanel',
    );
    expect(findShortcutCommand(keyEvent({ key: 'k', ctrlKey: true, target: input }), table)).toBe(
      'app.commandPalette',
    );
  });
});

describe('isTypingTarget', () => {
  it('recognizes text entry surfaces', () => {
    const text = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
  });

  it('ignores buttons, checkboxes and non-elements', () => {
    const button = document.createElement('button');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
