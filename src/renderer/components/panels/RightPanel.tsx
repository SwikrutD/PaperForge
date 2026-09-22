import type { ReactElement } from 'react';
import { MousePointerSquareDashed, X } from 'lucide-react';
import type { RightPanelId } from '@shared/schemas/settings';
import { useCommands } from '../../commands/useCommands';
import { cx } from '../../utils/classNames';
import { IconButton } from '../controls/IconButton';
import { ToolCard } from '../home/ToolCard';
import { TOOL_CATALOG } from '../home/toolCatalog';
import { EmptyPanelState } from './EmptyPanelState';
import styles from './RightPanel.module.css';

const TABS: Array<{ id: RightPanelId; label: string }> = [
  { id: 'properties', label: 'Properties' },
  { id: 'tools', label: 'Tools' },
];

/** Properties and tools for whatever is selected in the workspace. */
export function RightPanel({ panel }: { panel: RightPanelId }): ReactElement {
  const { execute, context } = useCommands();

  const select = (id: RightPanelId): void => {
    void context?.actions.setRightPanel(id);
  };

  return (
    <section
      className={styles.panel}
      aria-label="Properties and tools"
      data-focus-region="rightPanel"
      tabIndex={-1}
    >
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Panel">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={panel === tab.id}
              className={cx(styles.tab, panel === tab.id && styles.tabActive)}
              onClick={() => select(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <IconButton
          icon={X}
          label="Close panel"
          size="small"
          onClick={() => execute('view.toggleRightPanel')}
        />
      </header>

      <div className={styles.body} role="tabpanel">
        {panel === 'properties' ? (
          <EmptyPanelState
            icon={MousePointerSquareDashed}
            title="Nothing selected"
            description="Select text, an image, an annotation or a form field to see its properties."
          />
        ) : (
          <div className={styles.tools}>
            {TOOL_CATALOG.map((tool) => (
              <ToolCard key={tool.id} tool={tool} compact />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
