import type { ReactElement } from 'react';
import { Info } from 'lucide-react';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import { Card } from '../surfaces/Card';
import { RecentFilesList } from './RecentFilesList';
import { ToolCard } from './ToolCard';
import { TOOL_CATALOG } from './toolCatalog';
import styles from './HomeScreen.module.css';

/**
 * What the workspace shows when no document is open.
 *
 * The tool grid is the product's shape, not a promise: a card is interactive
 * only when its command exists, and every other card is genuinely disabled and
 * says what it is waiting for.
 */
export function HomeScreen({
  recentFiles,
}: {
  recentFiles: readonly RecentFileEntry[];
}): ReactElement {
  return (
    <div className={styles.home}>
      <header className={styles.intro}>
        <h1 className={styles.title}>PaperForge</h1>
        <p className={styles.lead}>
          An offline PDF workspace for Windows. Files stay on this computer: no account, no
          telemetry, no cloud services.
        </p>
      </header>

      <p className={styles.note}>
        <Info className={styles.noteIcon} aria-hidden="true" strokeWidth={1.75} />
        <span>
          This build contains the workspace shell, settings and command system. Opening and viewing
          documents arrives with the viewer, and each tool below switches on when its capability is
          built.
        </span>
      </p>

      <Card
        title="Recent files"
        description="Pinned files first. This list never leaves your computer."
      >
        <RecentFilesList entries={recentFiles} />
      </Card>

      <section className={styles.tools} aria-labelledby="pf-tools-heading">
        <div className={styles.toolsHeader}>
          <h2 className={styles.toolsTitle} id="pf-tools-heading">
            Tools
          </h2>
          <p className={styles.toolsSubtitle}>
            Greyed-out tools are not part of this build and cannot be started.
          </p>
        </div>
        <div className={styles.toolGrid}>
          {TOOL_CATALOG.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </section>
    </div>
  );
}
