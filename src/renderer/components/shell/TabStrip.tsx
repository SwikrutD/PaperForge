import { useRef, useState, type ReactElement } from 'react';
import { FileText, X } from 'lucide-react';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import { ContextMenu, type ContextMenuItem } from '../controls/ContextMenu';
import styles from './TabStrip.module.css';

interface MenuState {
  sessionId: string;
  x: number;
  y: number;
}

/**
 * Document tabs. Reordering uses native drag and drop; every tab also has a
 * context menu, because dragging is not available to keyboard users.
 */
export function TabStrip(): ReactElement | null {
  const tabs = useDocumentStore((state) => state.tabs);
  const activeId = useDocumentStore((state) => state.activeId);
  const activate = useDocumentStore((state) => state.activate);
  const close = useDocumentStore((state) => state.close);
  const closeOthers = useDocumentStore((state) => state.closeOthers);
  const closeToRight = useDocumentStore((state) => state.closeToRight);
  const move = useDocumentStore((state) => state.move);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const dragged = useRef<string | null>(null);

  if (tabs.length === 0) return null;

  const menuItems = (sessionId: string): ContextMenuItem[] => {
    const index = tabs.findIndex((tab) => tab.session.id === sessionId);
    return [
      { id: 'close', label: 'Close', onSelect: () => void close(sessionId) },
      {
        id: 'closeOthers',
        label: 'Close others',
        disabled: tabs.length < 2,
        onSelect: () => void closeOthers(sessionId),
      },
      {
        id: 'closeRight',
        label: 'Close to the right',
        disabled: index < 0 || index === tabs.length - 1,
        onSelect: () => void closeToRight(sessionId),
      },
      {
        id: 'moveLeft',
        label: 'Move left',
        group: 'move',
        disabled: index <= 0,
        onSelect: () => move(sessionId, index - 1),
      },
      {
        id: 'moveRight',
        label: 'Move right',
        group: 'move',
        disabled: index < 0 || index === tabs.length - 1,
        onSelect: () => move(sessionId, index + 1),
      },
    ];
  };

  return (
    <div className={styles.strip} role="tablist" aria-label="Open documents">
      {tabs.map((tab, index) => (
        <TabButton
          key={tab.session.id}
          tab={tab}
          active={tab.session.id === activeId}
          onActivate={() => activate(tab.session.id)}
          onClose={() => void close(tab.session.id)}
          onContextMenu={(x, y) => setMenu({ sessionId: tab.session.id, x, y })}
          onDragStart={() => {
            dragged.current = tab.session.id;
          }}
          onDropBefore={() => {
            if (dragged.current !== null) move(dragged.current, index);
            dragged.current = null;
          }}
        />
      ))}

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Tab actions"
          items={menuItems(menu.sessionId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface TabButtonProps {
  tab: DocumentTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (x: number, y: number) => void;
  onDragStart: () => void;
  onDropBefore: () => void;
}

function TabButton({
  tab,
  active,
  onActivate,
  onClose,
  onContextMenu,
  onDragStart,
  onDropBefore,
}: TabButtonProps): ReactElement {
  const { session, externalChange } = tab;
  const title =
    externalChange === 'deleted'
      ? `${session.file.path} — the file is no longer there`
      : externalChange === 'modified'
        ? `${session.file.path} — changed outside PaperForge`
        : session.file.path;

  return (
    <div
      className={cx(styles.tab, active && styles.active)}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDropBefore();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={styles.label}
        title={title}
        onClick={onActivate}
        onAuxClick={(event) => {
          // Middle-click closes, as in every tabbed Windows application.
          if (event.button === 1) onClose();
        }}
      >
        <FileText className={styles.icon} aria-hidden="true" strokeWidth={1.6} />
        <span className={styles.name}>{session.file.displayName}</span>
        {session.dirty && (
          <span className={styles.dirty} title="Unsaved changes" aria-label="Unsaved changes" />
        )}
        {externalChange !== null && (
          <span className={styles.changed} aria-label="Changed on disk">
            !
          </span>
        )}
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label={`Close ${session.file.displayName}`}
        onClick={onClose}
      >
        <X className={styles.closeIcon} aria-hidden="true" strokeWidth={2} />
      </button>
    </div>
  );
}
