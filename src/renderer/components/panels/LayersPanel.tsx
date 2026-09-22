import type { ReactElement } from 'react';
import type { PdfLayer } from '@pdf/render/types';
import { Toggle } from '../controls/Toggle';
import styles from './LayersPanel.module.css';

interface LayersPanelProps {
  layers: readonly PdfLayer[];
  onToggle: (id: string, visible: boolean) => void;
}

/**
 * Optional content groups. Turning one off hides it in the view only; the
 * document on disk is untouched, and the state is not saved yet.
 */
export function LayersPanel({ layers, onToggle }: LayersPanelProps): ReactElement {
  return (
    <div className={styles.panel}>
      <ul className={styles.list}>
        {layers.map((layer) => (
          <li key={layer.id} className={styles.item}>
            <Toggle
              checked={layer.visible}
              label={layer.name}
              onChange={(checked) => onToggle(layer.id, checked)}
            />
          </li>
        ))}
      </ul>
      <p className={styles.note}>Visibility applies to this view only and is not saved.</p>
    </div>
  );
}
