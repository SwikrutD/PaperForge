import type { ReactElement } from 'react';
import { useCommands } from '../../commands/useCommands';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useUiStore } from '../../stores/uiStore';
import { COMMENT_TOOL_GROUPS, commentToolTooltip } from '../annotations/commentTools';
import styles from './CommentToolsSection.module.css';

/**
 * The comment tools, in the Tools pane.
 *
 * The comment toolbar shows only while commenting is on, so from anywhere
 * else — the content editor in particular — picking Highlight meant the menu.
 * Here every comment tool is a click away whenever a document is open; the
 * click leaves whatever mode the page was in and starts commenting with it.
 */
export function CommentToolsSection(): ReactElement {
  const { context } = useCommands();
  const commenting = useUiStore((state) => state.commenting);
  const current = useAnnotationStore((state) => state.tool);

  return (
    <section className={styles.section} aria-labelledby="pf-comment-tools-heading">
      <h3 className={styles.title} id="pf-comment-tools-heading">
        Comment tools
      </h3>
      {COMMENT_TOOL_GROUPS.map((group) =>
        group
          .filter((entry) => entry.tool !== 'select')
          .map((entry) => {
            const Icon = entry.icon;
            const active = commenting && current === entry.tool;
            return (
              <button
                key={entry.tool}
                type="button"
                className={styles.tool}
                aria-pressed={active}
                title={commentToolTooltip(entry)}
                disabled={context === null}
                onClick={() => context?.actions.setAnnotationTool(entry.tool)}
              >
                <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
                <span>{entry.label}</span>
              </button>
            );
          }),
      )}
    </section>
  );
}
