import type { ReactElement } from 'react';
import { useCommands } from '../../commands/useCommands';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useUiStore } from '../../stores/uiStore';
import { COMMENT_TOOL_GROUPS, commentToolTooltip } from '../annotations/commentTools';
import { IconButton } from '../controls/IconButton';
import styles from './CommentToolsSection.module.css';

/**
 * The comment tools, at the top of the Tools pane.
 *
 * The comment toolbar shows only while commenting is on, so from anywhere
 * else — the content editor in particular — picking Highlight meant the menu.
 * Here every comment tool is a click away whenever a document is open; the
 * click leaves whatever mode the page was in and starts commenting with it.
 * They are a compact row of icons, named and with tooltips like the toolbar's,
 * so the tool cards below stay in view.
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
      <div className={styles.tools}>
        {COMMENT_TOOL_GROUPS.map((group) => {
          const tools = group.filter((entry) => entry.tool !== 'select');
          if (tools.length === 0) return null;
          return (
            <div key={tools[0]?.tool} className={styles.group}>
              {tools.map((entry) => (
                <IconButton
                  key={entry.tool}
                  icon={entry.icon}
                  label={entry.label}
                  tooltip={commentToolTooltip(entry)}
                  pressed={commenting && current === entry.tool}
                  disabled={context === null}
                  onClick={() => context?.actions.setAnnotationTool(entry.tool)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
