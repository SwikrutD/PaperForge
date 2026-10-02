import type { ReactElement } from 'react';
import { useCommands } from '../../commands/useCommands';
import { cx } from '../../utils/classNames';
import type { ToolCatalogEntry } from './toolCatalog';
import styles from './ToolCard.module.css';

interface ToolCardProps {
  tool: ToolCatalogEntry;
  compact?: boolean;
}

/**
 * A tool is interactive only when its command is enabled. Otherwise the card
 * is genuinely disabled and gives the command's own reason — it never accepts
 * a click that would do nothing.
 */
export function ToolCard({ tool, compact = false }: ToolCardProps): ReactElement {
  const { execute, resolve } = useCommands();
  const resolved = resolve(tool.commandId);
  const available = resolved?.enabled === true;
  const Icon = tool.icon;
  const reason = resolved?.reason ?? 'Not available right now.';

  return (
    <button
      type="button"
      className={cx(styles.card, compact && styles.compact, !available && styles.unavailable)}
      disabled={!available}
      title={available ? tool.description : reason}
      onClick={() => execute(tool.commandId)}
    >
      <span className={styles.iconTile} aria-hidden="true">
        <Icon className={styles.icon} strokeWidth={1.6} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{tool.title}</span>
        <span className={styles.description}>{tool.description}</span>
      </span>
      {!available && <span className={styles.badge}>Needs a document</span>}
    </button>
  );
}
