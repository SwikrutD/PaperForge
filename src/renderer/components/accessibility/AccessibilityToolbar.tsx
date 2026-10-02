import type { ReactElement } from 'react';
import { Accessibility } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { useAccessibilityStore } from '../../stores/accessibilityStore';
import { Button } from '../controls/Button';
import styles from '../redact/RedactionToolbar.module.css';

/**
 * Says the Accessibility Check is on, under the viewer toolbar like the other
 * tools. The check itself is in the properties panel.
 */
export function AccessibilityToolbar(): ReactElement {
  const { execute } = useCommands();
  const showing = useAccessibilityStore((state) => state.showReadingOrder);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Accessibility Check">
      <div className={styles.group}>
        <Accessibility size={16} aria-hidden="true" />
        <span>
          {showing
            ? 'Numbered boxes show the order the tags read each page in; dashed boxes are text the tags leave out.'
            : 'Choose an item in the panel to see it on the page.'}
        </span>
      </div>
      <span className={styles.spacer} />
      <div className={styles.group}>
        <Button onClick={() => execute('tools.accessibility')}>Done</Button>
      </div>
    </div>
  );
}
