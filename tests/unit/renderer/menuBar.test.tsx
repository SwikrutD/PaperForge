// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MenuBar, type MenuModel } from '../../../src/renderer/components/controls/MenuBar';

/**
 * A long menu is moved through by keyboard: the arrow keys skip what cannot
 * be used, Home and End go to either end, and the menu is no taller than the
 * window has room for.
 */

const menus: MenuModel[] = [
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { id: 'a', label: 'Alpha', disabled: true, onSelect: vi.fn() },
      { id: 'b', label: 'Bravo', onSelect: vi.fn() },
      { id: 'c', label: 'Charlie', disabled: true, onSelect: vi.fn() },
      { id: 'd', label: 'Delta', onSelect: vi.fn() },
      { id: 'e', label: 'Echo', disabled: true, onSelect: vi.fn() },
    ],
  },
];

function focused(): string {
  return document.activeElement?.textContent ?? '';
}

async function openWithKeyboard(): Promise<void> {
  render(<MenuBar menus={menus} />);
  screen.getByRole('menuitem', { name: 'Tools' }).focus();
  await userEvent.keyboard('{ArrowDown}');
  // Opening focuses the first item on the next frame.
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

describe('moving through a menu by keyboard', () => {
  it('starts on the first item that can be used', async () => {
    await openWithKeyboard();
    expect(focused()).toBe('Bravo');
  });

  it('skips unavailable items going down and up, and goes round the ends', async () => {
    await openWithKeyboard();
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Delta');
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Bravo');
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Delta');
  });

  it('goes to the last and the first usable item with End and Home', async () => {
    await openWithKeyboard();
    await userEvent.keyboard('{End}');
    expect(focused()).toBe('Delta');
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe('Bravo');
  });
});

describe('the height of an open menu', () => {
  it('is capped to the room the window has below it', async () => {
    await openWithKeyboard();
    const menu = screen.getByRole('menu', { name: 'Tools' });
    expect(menu.style.maxHeight).toMatch(/px$/);
    expect(parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight);
  });
});
