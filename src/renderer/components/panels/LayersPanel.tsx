import type { ReactElement } from 'react';
import { Eye, EyeOff, Save } from 'lucide-react';
import type { PdfLayer, PdfLayerEntry } from '@pdf/render/types';
import { Button } from '../controls/Button';
import { Toggle } from '../controls/Toggle';
import styles from './LayersPanel.module.css';

interface LayersPanelProps {
  layers: readonly PdfLayerEntry[];
  onToggle: (id: string, visible: boolean) => void;
  /** Writes the visibility shown now as what the document opens with. */
  onSaveDefaults: (layers: Array<{ id: string; visible: boolean }>) => void;
  /** Why the defaults cannot be saved, when they cannot. */
  saveProblem: string | null;
}

/**
 * Optional content groups, nested the way the document arranges them.
 *
 * Turning a layer off hides it in this view only. Saving the visibility as
 * the default is a separate, undoable change to the document, so looking at
 * a drawing with its annotations hidden does not quietly change the file.
 */
export function LayersPanel({
  layers,
  onToggle,
  onSaveDefaults,
  saveProblem,
}: LayersPanelProps): ReactElement {
  const groups = layers.filter((entry): entry is PdfLayer => entry.kind === 'layer');
  const showAll = (visible: boolean): void => {
    for (const layer of groups) if (layer.visible !== visible) onToggle(layer.id, visible);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.actions}>
        <Button icon={Eye} onClick={() => showAll(true)}>
          Show all
        </Button>
        <Button icon={EyeOff} onClick={() => showAll(false)}>
          Hide all
        </Button>
      </div>
      <ul className={styles.list}>
        {layers.map((entry, index) =>
          entry.kind === 'heading' ? (
            <li
              key={`heading-${String(index)}`}
              className={styles.heading}
              style={{ paddingLeft: `${String(entry.depth * 16)}px` }}
            >
              {entry.name}
            </li>
          ) : (
            <li
              key={entry.id}
              className={styles.item}
              style={{ paddingLeft: `${String(entry.depth * 16)}px` }}
            >
              <Toggle
                checked={entry.visible}
                label={entry.name}
                onChange={(checked) => onToggle(entry.id, checked)}
              />
            </li>
          ),
        )}
      </ul>
      <div className={styles.footer}>
        <p className={styles.note}>
          Visibility applies to this view. Save it to make it what the document shows when it is
          opened.
        </p>
        <Button
          icon={Save}
          disabled={saveProblem !== null}
          title={saveProblem ?? 'Make this visibility the document’s default'}
          onClick={() =>
            onSaveDefaults(groups.map((layer) => ({ id: layer.id, visible: layer.visible })))
          }
        >
          Save as default
        </Button>
      </div>
    </div>
  );
}
