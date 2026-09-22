import type { ReactElement } from 'react';
import { Bookmark, Layers, Paperclip, StickyNote } from 'lucide-react';
import type { LeftPanelId } from '@shared/schemas/settings';
import { useCommands } from '../../commands/useCommands';
import { IconButton } from '../controls/IconButton';
import styles from './LeftRail.module.css';

const RAIL: Array<{ panel: LeftPanelId; commandId: string; label: string; icon: typeof Bookmark }> =
  [
    { panel: 'pages', commandId: 'view.showPages', label: 'Page Thumbnails', icon: StickyNote },
    { panel: 'bookmarks', commandId: 'view.showBookmarks', label: 'Bookmarks', icon: Bookmark },
    {
      panel: 'attachments',
      commandId: 'view.showAttachments',
      label: 'Attachments',
      icon: Paperclip,
    },
    { panel: 'layers', commandId: 'view.showLayers', label: 'Layers', icon: Layers },
  ];

/**
 * Vertical rail that chooses the left panel. Selecting the panel already shown
 * collapses it, which is how Windows side rails behave.
 */
export function LeftRail(): ReactElement {
  const { execute, resolve } = useCommands();

  return (
    <nav
      className={styles.rail}
      aria-label="Navigation panels"
      data-focus-region="leftRail"
      tabIndex={-1}
    >
      {RAIL.map(({ commandId, label, icon }) => {
        const resolved = resolve(commandId);
        const checked = resolved?.checked ?? false;
        return (
          <IconButton
            key={commandId}
            icon={icon}
            label={label}
            pressed={checked}
            disabled={resolved?.enabled === false}
            disabledReason={resolved?.reason}
            onClick={() => execute(checked ? 'view.toggleLeftPanel' : commandId)}
          />
        );
      })}
    </nav>
  );
}
