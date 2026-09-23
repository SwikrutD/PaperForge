import { useState, type MouseEvent, type ReactElement } from 'react';
import {
  Check,
  Copy,
  Crop,
  FileOutput,
  FilePlus2,
  Hash,
  MoveRight,
  RotateCcwSquare,
  RotateCwSquare,
  Scissors,
  Trash,
} from 'lucide-react';
import { Button } from '../controls/Button';
import { ContextMenu, type ContextMenuItem } from '../controls/ContextMenu';
import { IconButton } from '../controls/IconButton';
import { useDocumentStore } from '../../stores/documentStore';
import { useOrganizeStore } from '../../stores/organizeStore';
import type { OrganizeActions } from './useOrganizeActions';
import styles from './OrganizeToolbar.module.css';

interface OrganizeToolbarProps {
  actions: OrganizeActions;
  pageCount: number;
  sessionId: string;
  disabled: boolean;
}

/** Where a menu was opened, so it appears under the button that opened it. */
type MenuAt = { kind: 'insert' | 'move'; x: number; y: number } | null;

/**
 * The organize toolbar: everything that can be done to the pages that are
 * chosen.
 *
 * A button that cannot do anything yet says why instead of disappearing, so
 * the toolbar does not change shape as pages are chosen.
 */
export function OrganizeToolbar({
  actions,
  pageCount,
  sessionId,
  disabled,
}: OrganizeToolbarProps): ReactElement {
  const openDialog = useOrganizeStore((state) => state.openDialog);
  const chooseAll = useOrganizeStore((state) => state.chooseAll);
  const clearSelection = useOrganizeStore((state) => state.clearSelection);
  const setActive = useOrganizeStore((state) => state.setActive);
  const busy = useOrganizeStore((state) => state.busy);
  const others = useDocumentStore((state) =>
    state.tabs.filter((tab) => tab.session.id !== sessionId),
  );
  const [menu, setMenu] = useState<MenuAt>(null);

  const chosen = actions.pages.length;
  const off = disabled || busy;
  const nothingChosen = chosen === 0 ? 'Choose a page first.' : undefined;
  const wouldEmpty = chosen >= pageCount ? 'A document must keep at least one page.' : undefined;

  const openMenu = (kind: 'insert' | 'move', event: MouseEvent<HTMLElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ kind, x: box.left, y: box.bottom + 2 });
  };

  const insertItems: ContextMenuItem[] = [
    { id: 'blank', label: 'Blank page', onSelect: actions.insertBlank },
    { id: 'pdf', label: 'Pages from a PDF…', onSelect: actions.insertFromPdf },
    { id: 'image', label: 'Image as a page…', onSelect: actions.insertImage },
    {
      id: 'replace',
      label: 'Replace this page from a PDF…',
      group: 'replace',
      disabled: chosen !== 1,
      onSelect: actions.replaceSelectedPage,
    },
  ];

  const moveItems: ContextMenuItem[] = others.map((tab) => ({
    id: tab.session.id,
    label: tab.session.file.displayName,
    onSelect: () => actions.moveToDocument(tab.session.id),
  }));

  return (
    <div className={styles.bar} role="toolbar" aria-label="Page tools">
      <p className={styles.count} aria-live="polite">
        {chosen === 0
          ? `${String(pageCount)} page${pageCount === 1 ? '' : 's'}`
          : `${String(chosen)} of ${String(pageCount)} selected`}
      </p>

      <div className={styles.group}>
        <Button onClick={() => chooseAll(pageCount)} disabled={off}>
          Select all
        </Button>
        <Button onClick={clearSelection} disabled={off || chosen === 0}>
          Clear
        </Button>
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        <IconButton
          icon={RotateCcwSquare}
          label="Rotate left"
          tooltip="Rotate the chosen pages a quarter anticlockwise"
          disabled={off || chosen === 0}
          disabledReason={nothingChosen}
          onClick={() => actions.rotate(-1)}
        />
        <IconButton
          icon={RotateCwSquare}
          label="Rotate right"
          tooltip="Rotate the chosen pages a quarter clockwise"
          disabled={off || chosen === 0}
          disabledReason={nothingChosen}
          onClick={() => actions.rotate(1)}
        />
        <IconButton
          icon={Copy}
          label="Duplicate pages"
          tooltip="Copy each chosen page, directly after itself"
          disabled={off || chosen === 0}
          disabledReason={nothingChosen}
          onClick={actions.duplicate}
        />
        <IconButton
          icon={Trash}
          label="Delete pages"
          tooltip="Remove the chosen pages. Undo brings them back."
          disabled={off || chosen === 0 || chosen >= pageCount}
          disabledReason={nothingChosen ?? wouldEmpty}
          onClick={actions.remove}
        />
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        <IconButton
          icon={FilePlus2}
          label="Insert pages"
          tooltip={
            chosen === 0
              ? 'Insert pages at the end of the document'
              : `Insert pages after page ${String(actions.insertIndex)}`
          }
          disabled={off}
          pressed={menu?.kind === 'insert'}
          onClick={(event) => openMenu('insert', event)}
        />
        <IconButton
          icon={FileOutput}
          label="Extract pages"
          tooltip="Write the chosen pages out as a new document"
          disabled={off || chosen === 0}
          disabledReason={nothingChosen}
          onClick={() => openDialog('extract')}
        />
        <IconButton
          icon={Scissors}
          label="Split document"
          tooltip="Write this document out in several pieces"
          disabled={off}
          onClick={() => openDialog('split')}
        />
        <IconButton
          icon={MoveRight}
          label="Move pages to another document"
          tooltip="Move the chosen pages into another open document"
          disabled={off || chosen === 0 || chosen >= pageCount || others.length === 0}
          disabledReason={
            others.length === 0 ? 'No other document is open.' : (nothingChosen ?? wouldEmpty)
          }
          pressed={menu?.kind === 'move'}
          onClick={(event) => openMenu('move', event)}
        />
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        <IconButton
          icon={Crop}
          label="Crop pages"
          tooltip="Change what the chosen pages show"
          disabled={off || chosen === 0}
          disabledReason={nothingChosen}
          onClick={() => openDialog('crop')}
        />
        <IconButton
          icon={Hash}
          label="Page numbering"
          tooltip="Change the numbers this document prints on its pages"
          disabled={off || chosen === 0}
          disabledReason={nothingChosen}
          onClick={() => openDialog('labels')}
        />
      </div>

      <div className={styles.end}>
        <Button appearance="primary" icon={Check} onClick={() => setActive(false)}>
          Done
        </Button>
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.kind === 'insert' ? 'Insert pages' : 'Move pages to'}
          items={menu.kind === 'insert' ? insertItems : moveItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
