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
 * A tool is interactive only when its command exists and is enabled. Otherwise
 * the card is genuinely disabled and says what it is waiting for — it never
 * accepts a click that would do nothing.
 *
 * "Not built yet" and "not possible right now" are different things, and the
 * card says which: a tool that exists but needs a document open gives the
 * command's own reason rather than claiming it does not exist.
 */
export function ToolCard({ tool, compact = false }: ToolCardProps): ReactElement {
  const { execute, resolve } = useCommands();
  const resolved = tool.commandId === undefined ? undefined : resolve(tool.commandId);
  const available = resolved?.enabled === true;
  const built = resolved !== undefined;
  const Icon = tool.icon;

  const reason = built
    ? (resolved.reason ?? 'Not available right now.')
    : `Not available yet — needs ${tool.requires}.`;

  return (
    <button
      type="button"
      className={cx(styles.card, compact && styles.compact, !available && styles.unavailable)}
      disabled={!available}
      title={available ? tool.description : reason}
      onClick={() => {
        if (tool.commandId !== undefined) execute(tool.commandId);
      }}
    >
      <span className={styles.iconTile} aria-hidden="true">
        <Icon className={styles.icon} strokeWidth={1.6} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{tool.title}</span>
        <span className={styles.description}>{tool.description}</span>
      </span>
      {!available && (
        <span className={styles.badge}>{built ? 'Needs a document' : 'Not yet available'}</span>
      )}
    </button>
  );
}
