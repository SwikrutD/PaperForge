import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  IndentDecrease,
  IndentIncrease,
  Italic,
  LocateFixed,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { BookmarkColor, BookmarkNode, BookmarkTarget } from '@shared/schemas/bookmark';
import { find, planMove, useBookmarkStore } from '../../stores/bookmarkStore';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import { IconButton } from '../controls/IconButton';
import { EmptyPanelState } from './EmptyPanelState';
import styles from './BookmarksPanel.module.css';

/** Colours a bookmark can be given; null leaves it to the reader. */
const COLOURS: ReadonlyArray<{ name: string; value: BookmarkColor | null }> = [
  { name: 'Default', value: null },
  { name: 'Red', value: { r: 0.8, g: 0.1, b: 0.1 } },
  { name: 'Orange', value: { r: 0.85, g: 0.45, b: 0 } },
  { name: 'Green', value: { r: 0.1, g: 0.55, b: 0.2 } },
  { name: 'Blue', value: { r: 0.1, g: 0.35, b: 0.8 } },
  { name: 'Purple', value: { r: 0.5, g: 0.2, b: 0.7 } },
  { name: 'Grey', value: { r: 0.45, g: 0.45, b: 0.45 } },
];

/**
 * Bookmarks that can be changed: added at the current view, renamed in place,
 * moved up, down, in and out, restyled, re-pointed and deleted — each one
 * undoable edit of the document.
 */
export function BookmarkEditor({ tab }: { tab: DocumentTab }): ReactElement {
  const sessionId = tab.session.id;
  const list = useBookmarkStore((state) => (state.listFor === sessionId ? state.list : null));
  const selectedPath = useBookmarkStore((state) => state.selected);
  const store = useBookmarkStore.getState;

  useEffect(() => {
    void store().load(sessionId, tab.edit.revision);
  }, [sessionId, tab.edit.revision, store]);

  const nodes = list?.bookmarks ?? [];
  const selected = find(nodes, selectedPath);
  const target: BookmarkTarget = { page: tab.view.pageNumber, top: tab.view.viewTop };
  const can = (direction: Parameters<typeof planMove>[2]): boolean =>
    selected !== null && planMove(nodes, selected, direction) !== null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (selected === null || store().renaming !== null) return;
    if (event.key === 'F2') {
      event.preventDefault();
      store().setRenaming(selected.path);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void store().remove(sessionId, selected);
    } else if (event.altKey && event.shiftKey) {
      const direction =
        event.key === 'ArrowUp'
          ? 'up'
          : event.key === 'ArrowDown'
            ? 'down'
            : event.key === 'ArrowRight'
              ? 'indent'
              : event.key === 'ArrowLeft'
                ? 'outdent'
                : null;
      if (direction === null) return;
      event.preventDefault();
      void store().move(sessionId, selected, direction);
    }
  };

  return (
    <div className={styles.editor} onKeyDown={onKeyDown}>
      <div className={styles.toolbar} role="toolbar" aria-label="Bookmark tools">
        <IconButton
          icon={BookmarkPlus}
          size="small"
          label="Add bookmark"
          tooltip={`Add a bookmark to the current view of page ${String(target.page)}`}
          onClick={() => void store().add(sessionId, target)}
        />
        <IconButton
          icon={LocateFixed}
          size="small"
          label="Set to current view"
          tooltip="Point the selected bookmark at the current view"
          disabled={selected === null}
          disabledReason="Select a bookmark first."
          onClick={() => selected !== null && void store().retarget(sessionId, selected, target)}
        />
        <IconButton
          icon={Pencil}
          size="small"
          label="Rename bookmark"
          tooltip="Rename (F2)"
          disabled={selected === null}
          disabledReason="Select a bookmark first."
          onClick={() => selected !== null && store().setRenaming(selected.path)}
        />
        <span className={styles.divider} aria-hidden="true" />
        <IconButton
          icon={ArrowUp}
          size="small"
          label="Move up"
          tooltip="Move up (Alt+Shift+Up)"
          disabled={!can('up')}
          onClick={() => selected !== null && void store().move(sessionId, selected, 'up')}
        />
        <IconButton
          icon={ArrowDown}
          size="small"
          label="Move down"
          tooltip="Move down (Alt+Shift+Down)"
          disabled={!can('down')}
          onClick={() => selected !== null && void store().move(sessionId, selected, 'down')}
        />
        <IconButton
          icon={IndentIncrease}
          size="small"
          label="Nest under the bookmark above"
          tooltip="Nest under the bookmark above (Alt+Shift+Right)"
          disabled={!can('indent')}
          onClick={() => selected !== null && void store().move(sessionId, selected, 'indent')}
        />
        <IconButton
          icon={IndentDecrease}
          size="small"
          label="Move out a level"
          tooltip="Move out a level (Alt+Shift+Left)"
          disabled={!can('outdent')}
          onClick={() => selected !== null && void store().move(sessionId, selected, 'outdent')}
        />
        <span className={styles.divider} aria-hidden="true" />
        <IconButton
          icon={Bold}
          size="small"
          label="Bold"
          pressed={selected?.style.bold === true}
          disabled={selected === null}
          onClick={() =>
            selected !== null &&
            void store().restyle(sessionId, selected, {
              ...selected.style,
              bold: !selected.style.bold,
            })
          }
        />
        <IconButton
          icon={Italic}
          size="small"
          label="Italic"
          pressed={selected?.style.italic === true}
          disabled={selected === null}
          onClick={() =>
            selected !== null &&
            void store().restyle(sessionId, selected, {
              ...selected.style,
              italic: !selected.style.italic,
            })
          }
        />
        <select
          className={styles.colour}
          aria-label="Bookmark colour"
          title="Colour"
          disabled={selected === null}
          value={colourName(selected?.style.color ?? null)}
          onChange={(event) => {
            const colour = COLOURS.find((entry) => entry.name === event.target.value);
            if (selected === null || colour === undefined) return;
            void store().restyle(sessionId, selected, { ...selected.style, color: colour.value });
          }}
        >
          {COLOURS.map((colour) => (
            <option key={colour.name} value={colour.name}>
              {colour.name}
            </option>
          ))}
          {colourName(selected?.style.color ?? null) === 'Custom' && (
            <option value="Custom">Custom</option>
          )}
        </select>
        <IconButton
          icon={Trash2}
          size="small"
          label="Delete bookmark"
          tooltip="Delete, with what is nested under it (Del)"
          disabled={selected === null}
          onClick={() => selected !== null && void store().remove(sessionId, selected)}
        />
      </div>

      {list === null ? (
        <p className={styles.loading}>Reading the bookmarks…</p>
      ) : nodes.length === 0 ? (
        <EmptyPanelState
          icon={Bookmark}
          title="No bookmarks"
          description="Add one to mark the current view of a page."
        />
      ) : (
        <ul className={styles.list} role="tree" aria-label="Bookmarks">
          {nodes.map((node) => (
            <EditableNode key={node.path} node={node} tab={tab} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EditableNode({
  node,
  tab,
  depth,
}: {
  node: BookmarkNode;
  tab: DocumentTab;
  depth: number;
}): ReactElement {
  const sessionId = tab.session.id;
  const updateView = useDocumentStore((state) => state.updateView);
  const selected = useBookmarkStore((state) => state.selected === node.path);
  const renaming = useBookmarkStore((state) => state.renaming === node.path);
  const [expanded, setExpanded] = useState(node.open || depth === 0);
  const store = useBookmarkStore.getState;
  const hasChildren = node.children.length > 0;
  const colour = node.style.color;

  return (
    <li
      className={styles.node}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <div
        className={cx(styles.row, selected && styles.selected)}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.twisty}
            aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown className={styles.twistyIcon} strokeWidth={2} />
            ) : (
              <ChevronRight className={styles.twistyIcon} strokeWidth={2} />
            )}
          </button>
        ) : (
          <span className={styles.twistySpacer} />
        )}

        {renaming ? (
          <input
            className={styles.rename}
            aria-label="Bookmark title"
            defaultValue={node.title}
            maxLength={2000}
            // The new title is typed straight away, the way a file is renamed.
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => void store().rename(sessionId, node, event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') store().setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.title}
            style={{
              ...(colour === null
                ? {}
                : {
                    color: `rgb(${String(Math.round(colour.r * 255))}, ${String(Math.round(colour.g * 255))}, ${String(Math.round(colour.b * 255))})`,
                  }),
              fontWeight: node.style.bold ? 'var(--pf-font-weight-medium)' : undefined,
              fontStyle: node.style.italic ? 'italic' : undefined,
            }}
            title={
              node.page === null
                ? 'This bookmark does not go to a page of this document.'
                : `Go to page ${String(node.page)}`
            }
            onClick={() => {
              store().select(node.path);
              if (node.page !== null) updateView(sessionId, { pendingPage: node.page });
            }}
            onDoubleClick={() => store().setRenaming(node.path)}
          >
            {node.title === '' ? '(untitled)' : node.title}
          </button>
        )}

        {node.page !== null && <span className={styles.page}>{node.page}</span>}
      </div>

      {hasChildren && expanded && (
        <ul className={styles.list} role="group">
          {node.children.map((child) => (
            <EditableNode key={child.path} node={child} tab={tab} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function colourName(colour: BookmarkColor | null): string {
  if (colour === null) return 'Default';
  const match = COLOURS.find(
    (entry) =>
      entry.value !== null &&
      Math.abs(entry.value.r - colour.r) < 0.02 &&
      Math.abs(entry.value.g - colour.g) < 0.02 &&
      Math.abs(entry.value.b - colour.b) < 0.02,
  );
  return match?.name ?? 'Custom';
}
