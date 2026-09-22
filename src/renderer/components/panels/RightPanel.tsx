import type { ReactElement } from 'react';
import { MousePointerSquareDashed, Wrench, X } from 'lucide-react';
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
  const { execute, context, resolve } = useCommands();

  const select = (id: RightPanelId): void => {
    void context?.actions.setRightPanel(id);
  };

  // The panel lists tools that can be used right now; the home screen shows the
  // whole catalogue including what is not built yet.
  const availableTools = TOOL_CATALOG.filter(
    (tool) => tool.commandId !== undefined && resolve(tool.commandId)?.enabled === true,
  );

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
        ) : availableTools.length === 0 ? (
          <EmptyPanelState
            icon={Wrench}
            title="No tools available yet"
            description="Tools appear here as each capability is built. The full list is on the home screen."
          />
        ) : (
          <div className={styles.tools}>
            {availableTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} compact />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
