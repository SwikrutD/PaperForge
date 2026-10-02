import type { ReactElement } from 'react';
import { ChevronDown, ChevronUp, Columns2, FolderOpen, Layers2, X } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { useCompareStore, type CompareSide } from '../../stores/compareStore';
import { useDocumentStore } from '../../stores/documentStore';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import styles from './compare.module.css';

const SIDES: Array<{ side: CompareSide; label: string }> = [
  { side: 'original', label: 'Original' },
  { side: 'revised', label: 'Revised' },
];

/** Opens a file for one side, and puts it on that side once it is open. */
async function openFor(side: CompareSide): Promise<void> {
  const documents = useDocumentStore.getState();
  const before = new Set(documents.tabs.map((tab) => tab.session.id));
  await documents.openWithDialog();
  const after = useDocumentStore.getState();
  // A new tab is the file just opened; a file already open is activated instead.
  const opened =
    after.tabs.find((tab) => !before.has(tab.session.id))?.session.id ??
    (after.activeId !== documents.activeId ? after.activeId : null);
  if (opened !== null) useCompareStore.getState().choose(side, opened);
}

/**
 * Which two documents, how their pages line up, and how to look at the
 * result.
 */
export function CompareToolbar(): ReactElement {
  const { execute } = useCommands();
  const tabs = useDocumentStore((state) => state.tabs);
  const originalId = useCompareStore((state) => state.originalId);
  const revisedId = useCompareStore((state) => state.revisedId);
  const offset = useCompareStore((state) => state.offset);
  const mode = useCompareStore((state) => state.mode);
  const syncScroll = useCompareStore((state) => state.syncScroll);
  const status = useCompareStore((state) => state.status);
  const hasDifferences = useCompareStore((state) => state.differences.length > 0);
  const store = useCompareStore.getState;

  const chosen = { original: originalId, revised: revisedId };
  const running = status === 'running';
  const ready = originalId !== null && revisedId !== null && originalId !== revisedId;

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Compare tools">
      {SIDES.map(({ side, label }) => (
        <div className={styles.group} key={side}>
          <label className={styles.fieldLabel} htmlFor={`compare-${side}`}>
            {label}
          </label>
          <select
            id={`compare-${side}`}
            className={styles.select}
            value={chosen[side] ?? ''}
            disabled={running}
            onChange={(event) => store().choose(side, event.target.value || null)}
          >
            <option value="">Choose a document</option>
            {tabs.map((tab) => (
              <option key={tab.session.id} value={tab.session.id}>
                {tab.session.file.displayName}
              </option>
            ))}
          </select>
          <IconButton
            icon={FolderOpen}
            label={`Open a file as the ${label.toLowerCase()} document`}
            size="small"
            disabled={running}
            onClick={() => void openFor(side)}
          />
        </div>
      ))}

      <div className={styles.group}>
        <label className={styles.fieldLabel} htmlFor="compare-offset">
          Page offset
        </label>
        <input
          id="compare-offset"
          type="number"
          className={styles.offset}
          value={offset}
          min={-999}
          max={999}
          disabled={running}
          title="How many pages the revision runs ahead: 1 when it gained a page at the front."
          onChange={(event) => store().setOffset(Number(event.target.value) || 0)}
        />
      </div>

      {running ? (
        <Button onClick={() => store().cancel()}>Stop</Button>
      ) : (
        <Button
          appearance="primary"
          disabled={!ready}
          title={
            ready
              ? undefined
              : originalId !== null && originalId === revisedId
                ? 'Choose two different documents.'
                : 'Choose a document for each side.'
          }
          onClick={() => void store().run()}
        >
          Compare
        </Button>
      )}

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group} role="group" aria-label="View">
        <IconButton
          icon={Columns2}
          label="Side by side"
          pressed={mode === 'sideBySide'}
          onClick={() => store().setMode('sideBySide')}
        />
        <IconButton
          icon={Layers2}
          label="Overlay"
          tooltip="Overlay: both pages in one picture, differences coloured"
          pressed={mode === 'overlay'}
          onClick={() => store().setMode('overlay')}
        />
        <label className={styles.filter}>
          <input
            type="checkbox"
            checked={syncScroll}
            disabled={mode !== 'sideBySide'}
            onChange={(event) => store().setSyncScroll(event.target.checked)}
          />
          Scroll together
        </label>
      </div>

      <div className={styles.group}>
        <IconButton
          icon={ChevronUp}
          label="Previous difference"
          disabled={!hasDifferences}
          onClick={() => store().step(-1)}
        />
        <IconButton
          icon={ChevronDown}
          label="Next difference"
          disabled={!hasDifferences}
          onClick={() => store().step(1)}
        />
      </div>

      <span className={styles.spacer} />
      <IconButton icon={X} label="Close Compare" onClick={() => execute('tools.compare')} />
    </div>
  );
}
