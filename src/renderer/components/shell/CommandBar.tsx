import { useMemo, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import type { CommandCategory } from '../../commands/types';
import { MenuBar, type MenuModel } from '../controls/MenuBar';
import styles from './CommandBar.module.css';

/**
 * Menus are generated from the command registry. A menu only appears when it
 * has commands, and an item only appears when the command really exists, so
 * the bar can never offer something PaperForge cannot do.
 */
const MENUS: Array<{ id: CommandCategory; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'tools', label: 'Tools' },
  { id: 'window', label: 'Window' },
  { id: 'help', label: 'Help' },
];

export function CommandBar(): ReactElement {
  const { registry, resolve, execute } = useCommands();

  const menus = useMemo<MenuModel[]>(() => {
    return MENUS.flatMap(({ id, label }) => {
      const definitions = registry.listByCategory(id);
      if (definitions.length === 0) return [];
      return [
        {
          id,
          label,
          items: definitions.map((definition) => {
            const resolved = resolve(definition.id);
            return {
              id: definition.id,
              label: definition.title,
              shortcut: definition.shortcut,
              checked:
                definition.isChecked === undefined ? undefined : (resolved?.checked ?? false),
              disabled: resolved?.enabled === false,
              reason: resolved?.reason,
              group: definition.group,
              onSelect: () => execute(definition.id),
            };
          }),
        },
      ];
    });
  }, [registry, resolve, execute]);

  return (
    <div className={styles.bar} data-focus-region="commandBar" tabIndex={-1}>
      <MenuBar menus={menus} />
      <button
        type="button"
        className={styles.search}
        onClick={() => execute('app.commandPalette')}
        title="Search commands (Ctrl+K)"
      >
        <Search className={styles.searchIcon} aria-hidden="true" strokeWidth={1.75} />
        <span>Search commands</span>
        <span className={styles.chord}>Ctrl+K</span>
      </button>
    </div>
  );
}
