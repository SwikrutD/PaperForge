import type { ReactElement } from 'react';
import { FilePlus2, FolderOpen } from 'lucide-react';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import { useCommands } from '../../commands/useCommands';
import { Button } from '../controls/Button';
import { Card } from '../surfaces/Card';
import { RecentFilesList } from './RecentFilesList';
import { ToolCard } from './ToolCard';
import { TOOL_CATALOG } from './toolCatalog';
import styles from './HomeScreen.module.css';

/**
 * What the workspace shows when no document is open.
 *
 * It starts the two things a reader comes here to do — open a PDF or make one
 * — and lists every tool. A tool that works on a document asks for one when
 * it is picked, then starts on it; it is never a dead card.
 */
export function HomeScreen({
  recentFiles,
}: {
  recentFiles: readonly RecentFileEntry[];
}): ReactElement {
  const { execute, resolve } = useCommands();

  return (
    <div className={styles.home}>
      <header className={styles.intro}>
        <h1 className={styles.title}>PaperForge</h1>
        <p className={styles.lead}>
          An offline PDF workspace for Windows. Files stay on this computer: no account, no
          telemetry, no cloud services.
        </p>
        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={FolderOpen}
            title="Open a PDF from this computer (Ctrl+O)"
            disabled={resolve('file.open')?.enabled !== true}
            onClick={() => execute('file.open')}
          >
            Open PDF
          </Button>
          <Button
            icon={FilePlus2}
            title="Make a PDF from images, text files, web pages or other PDFs (Ctrl+N)"
            disabled={resolve('tools.create')?.enabled !== true}
            onClick={() => execute('tools.create')}
          >
            Create PDF
          </Button>
          <span className={styles.hint}>or drop a PDF anywhere on this window</span>
        </div>
      </header>

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
            A tool that works on a document asks you to choose one, then starts.
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
