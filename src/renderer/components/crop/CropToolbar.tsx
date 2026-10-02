import type { ReactElement } from 'react';
import { Crop } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { useCropStore } from '../../stores/cropStore';
import { Button } from '../controls/Button';
import styles from '../redact/RedactionToolbar.module.css';

/**
 * Says the crop tool is on and how to use it, under the viewer toolbar like
 * the other tools. The controls themselves are in the properties panel.
 */
export function CropToolbar(): ReactElement {
  const { execute } = useCommands();
  const hasFrame = useCropStore((state) => state.frame !== null);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Crop tools">
      <div className={styles.group}>
        <Crop size={16} aria-hidden="true" />
        <span>
          {hasFrame
            ? 'Drag the frame or its handles to adjust it, then apply it from the panel.'
            : 'Drag on a page to draw what it should show.'}
        </span>
      </div>
      <span className={styles.spacer} />
      <div className={styles.group}>
        <Button disabled={!hasFrame} onClick={() => useCropStore.getState().setFrame(null)}>
          Clear frame
        </Button>
        <Button onClick={() => execute('tools.crop')}>Done</Button>
      </div>
    </div>
  );
}
