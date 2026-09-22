import { useEffect, useRef, type ReactElement } from 'react';
import styles from '../controls/MenuBar.module.css';
import contextStyles from './ContextMenu.module.css';

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean | undefined;
  /** Items of different groups are separated by a rule. */
  group?: string | undefined;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

/**
 * Right-click menu. Opens at the pointer, keeps focus inside, closes on Escape
 * or an outside click, and is nudged back on screen when it would overflow.
 */
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;

    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
    menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  const focusItem = (index: number): void => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (buttons.length === 0) return;
    buttons[((index % buttons.length) + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={menuRef}
      className={`${styles.popup} ${contextStyles.menu}`}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {items.map((item, index) => {
        const previous = items[index - 1];
        const startsGroup = index > 0 && previous?.group !== item.group;
        return (
          <div key={item.id}>
            {startsGroup && <div className={styles.separator} role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={item.disabled === true}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  focusItem(index + 1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  focusItem(index - 1);
                }
              }}
            >
              <span className={styles.check} aria-hidden="true" />
              <span className={styles.label}>{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
