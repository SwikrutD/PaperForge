import { useEffect, type ReactElement } from 'react';
import { IconButton } from '../controls/IconButton';
import { useAnnotationStore } from '../../stores/annotationStore';
import { COMMENT_TOOL_GROUPS, commentToolTooltip } from './commentTools';
import styles from './AnnotationToolbar.module.css';

/**
 * The comment tools.
 *
 * It appears under the viewer toolbar while commenting is on, so the page
 * keeps as much room as it can when the reader is only reading.
 */
export function AnnotationToolbar({ disabled }: { disabled: boolean }): ReactElement {
  const tool = useAnnotationStore((state) => state.tool);
  const setTool = useAnnotationStore((state) => state.setTool);

  // Escape puts the pointer back to selecting, the way every drawing tool
  // behaves. A dialog or the find bar handles its own Escape first.
  useEffect(() => {
    if (tool === 'select') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setTool('select');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, setTool]);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Comment tools">
      {COMMENT_TOOL_GROUPS.map((group, index) => (
        <div className={styles.group} key={group[0]?.tool ?? index}>
          {index > 0 && <span className={styles.divider} aria-hidden="true" />}
          {group.map((entry) => (
            <IconButton
              key={entry.tool}
              icon={entry.icon}
              label={entry.label}
              tooltip={commentToolTooltip(entry)}
              pressed={tool === entry.tool}
              disabled={disabled}
              onClick={() => setTool(tool === entry.tool ? 'select' : entry.tool)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
