import type { ReactElement } from 'react';
import { NO_DOCUMENT_REASON } from '../../commands/definitions';
import { useCommands } from '../../commands/useCommands';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { cx } from '../../utils/classNames';
import type { ToolCatalogEntry } from './toolCatalog';
import styles from './ToolCard.module.css';

interface ToolCardProps {
  tool: ToolCatalogEntry;
  compact?: boolean;
}

/**
 * A tool runs its command when it can. A tool that is waiting only for a
 * document asks for one instead of sitting there greyed out: the file picker
 * opens, and the tool starts once the chosen document has opened. A tool that
 * cannot run for any other reason is disabled and gives the command's reason.
 */
export function ToolCard({ tool, compact = false }: ToolCardProps): ReactElement {
  const { run, resolve } = useCommands();
  const resolved = resolve(tool.commandId);
  const available = resolved?.enabled === true;
  const asksForDocument = !available && resolved?.reason === NO_DOCUMENT_REASON;
  const usable = available || asksForDocument;
  const Icon = tool.icon;

  const openThenStart = async (): Promise<void> => {
    useUiStore.getState().setToolAfterOpen(tool.commandId);
    await run('file.open');
    // Nothing was opened, so nothing is waiting to start any more.
    if (useDocumentStore.getState().activeId === null) {
      useUiStore.getState().setToolAfterOpen(null);
    }
  };

  const title = available
    ? tool.description
    : asksForDocument
      ? `Choose a PDF to open, then ${lowerFirst(tool.description)}`
      : (resolved?.reason ?? 'Not available right now.');

  return (
    <button
      type="button"
      className={cx(styles.card, compact && styles.compact, !usable && styles.unavailable)}
      disabled={!usable}
      title={title}
      onClick={() => {
        if (available) void run(tool.commandId);
        else if (asksForDocument) void openThenStart();
      }}
    >
      <span className={styles.iconTile} aria-hidden="true">
        <Icon className={styles.icon} strokeWidth={1.6} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{tool.title}</span>
        <span className={styles.description}>{tool.description}</span>
      </span>
      {asksForDocument && <span className={styles.badge}>Opens a PDF</span>}
      {!usable && <span className={styles.badge}>Unavailable</span>}
    </button>
  );
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toLowerCase() ?? ''}${text.slice(1)}`;
}
