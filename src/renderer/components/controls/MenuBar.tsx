import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import { formatShortcut } from '../../keyboard/shortcuts';
import { cx } from '../../utils/classNames';
import styles from './MenuBar.module.css';

export interface MenuItemModel {
  id: string;
  label: string;
  shortcut?: string | undefined;
  checked?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Tooltip explaining why the item is unavailable. */
  reason?: string | undefined;
  /** Items of different groups are separated by a rule. */
  group?: string | undefined;
  onSelect: () => void;
}

export interface MenuModel {
  id: string;
  label: string;
  items: MenuItemModel[];
}

/**
 * Windows-style menu bar: Alt-free click or keyboard operation, roving focus
 * inside a menu, Escape to close, and arrow keys to move between menus.
 * Items are supplied by the command registry, so every entry does something.
 */
export function MenuBar({ menus }: { menus: readonly MenuModel[] }): ReactElement {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const closeAndFocusTrigger = useCallback((menuId: string) => {
    setOpenMenuId(null);
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menuId}"]`)
      ?.focus();
  }, []);

  useEffect(() => {
    if (openMenuId === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (containerRef.current?.contains(event.target) === true) return;
      setOpenMenuId(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [openMenuId]);

  const focusItem = (menuId: string, index: number): void => {
    const menu = menus.find((candidate) => candidate.id === menuId);
    if (menu === undefined || menu.items.length === 0) return;
    const count = menu.items.length;
    const wrapped = ((index % count) + count) % count;
    const item = menu.items[wrapped];
    if (item === undefined) return;
    itemRefs.current.get(`${menuId}:${item.id}`)?.focus();
  };

  const siblingMenuId = (menuId: string, delta: number): string | undefined => {
    const index = menus.findIndex((menu) => menu.id === menuId);
    if (index < 0 || menus.length === 0) return undefined;
    return menus[(index + delta + menus.length) % menus.length]?.id;
  };

  const focusTrigger = (menuId: string | undefined): void => {
    if (menuId === undefined) return;
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menuId}"]`)
      ?.focus();
  };

  const moveMenu = (menuId: string, delta: number): void => {
    const index = menus.findIndex((menu) => menu.id === menuId);
    const next = menus[(index + delta + menus.length) % menus.length];
    if (next === undefined) return;
    setOpenMenuId(next.id);
    requestAnimationFrame(() => focusItem(next.id, 0));
  };

  return (
    <div className={styles.bar} ref={containerRef} role="menubar" aria-label="Main menu">
      {menus.map((menu) => {
        const open = openMenuId === menu.id;
        return (
          <div key={menu.id} className={styles.menu}>
            <button
              type="button"
              role="menuitem"
              data-menu-trigger={menu.id}
              className={cx(styles.trigger, open && styles.triggerOpen)}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpenMenuId(open ? null : menu.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setOpenMenuId(menu.id);
                  requestAnimationFrame(() => focusItem(menu.id, 0));
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  focusTrigger(siblingMenuId(menu.id, 1));
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  focusTrigger(siblingMenuId(menu.id, -1));
                }
              }}
            >
              {menu.label}
            </button>

            {open && (
              <div className={styles.popup} role="menu" aria-label={menu.label}>
                {menu.items.map((item, index) => {
                  const previous = menu.items[index - 1];
                  const startsGroup = index > 0 && previous?.group !== item.group;
                  return (
                    <div key={item.id}>
                      {startsGroup && <div className={styles.separator} role="separator" />}
                      <button
                        type="button"
                        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                        {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
                        className={styles.item}
                        disabled={item.disabled === true}
                        title={item.disabled === true ? item.reason : undefined}
                        ref={(element) => {
                          const key = `${menu.id}:${item.id}`;
                          if (element === null) itemRefs.current.delete(key);
                          else itemRefs.current.set(key, element);
                        }}
                        onClick={() => {
                          setOpenMenuId(null);
                          item.onSelect();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            focusItem(menu.id, index + 1);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            focusItem(menu.id, index - 1);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            closeAndFocusTrigger(menu.id);
                          } else if (event.key === 'ArrowRight') {
                            event.preventDefault();
                            moveMenu(menu.id, 1);
                          } else if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            moveMenu(menu.id, -1);
                          } else if (event.key === 'Tab') {
                            setOpenMenuId(null);
                          }
                        }}
                      >
                        <span className={styles.check} aria-hidden="true">
                          {item.checked === true && (
                            <Check className={styles.checkIcon} strokeWidth={2.5} />
                          )}
                        </span>
                        <span className={styles.label}>{item.label}</span>
                        {item.shortcut !== undefined && (
                          <span className={styles.shortcut}>{formatShortcut(item.shortcut)}</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
