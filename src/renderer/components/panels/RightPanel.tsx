import type { ReactElement } from 'react';
import { MousePointerSquareDashed, Wrench, X } from 'lucide-react';
import type { RightPanelId } from '@shared/schemas/settings';
import { useCommands } from '../../commands/useCommands';
import { useDocumentStore } from '../../stores/documentStore';
import { useOrganizeStore } from '../../stores/organizeStore';
import { useTextEditStore } from '../../stores/textEditStore';
import { useEditTargetStore } from '../../stores/editTargetStore';
import { LinkProperties } from '../edit/LinkProperties';
import { useUiStore } from '../../stores/uiStore';
import { DocumentProperties } from '../workspace/DocumentProperties';
import { AnnotationProperties } from '../annotations/AnnotationProperties';
import { CommentsPanel } from '../annotations/CommentsPanel';
import { PageProperties } from '../organize/PageProperties';
import { TextProperties } from '../edit/TextProperties';
import { ImageProperties } from '../edit/ImageProperties';
import { selectedAnnotation, useAnnotationStore } from '../../stores/annotationStore';
import { cx } from '../../utils/classNames';
import { IconButton } from '../controls/IconButton';
import { ToolCard } from '../home/ToolCard';
import { TOOL_CATALOG } from '../home/toolCatalog';
import { EmptyPanelState } from './EmptyPanelState';
import styles from './RightPanel.module.css';

const TABS: Array<{ id: RightPanelId; label: string }> = [
  { id: 'properties', label: 'Properties' },
  { id: 'comments', label: 'Comments' },
  { id: 'tools', label: 'Tools' },
];

/** Properties and tools for whatever is selected in the workspace. */
export function RightPanel({ panel }: { panel: RightPanelId }): ReactElement {
  const { execute, context, resolve } = useCommands();
  const activeTab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((tab) => tab.session.id === active) ?? null;
  });
  const annotations = useAnnotationStore((state) => state.annotations);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const commenting = useUiStore((state) => state.commenting);
  const organizing = useOrganizeStore((state) => state.active);
  const editingText = useTextEditStore((state) => state.active);
  const editTarget = useEditTargetStore((state) => state.target);
  const selected = selectedAnnotation({ annotations, selectedId });

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
        {panel === 'comments' ? (
          activeTab === null ? (
            <EmptyPanelState
              icon={MousePointerSquareDashed}
              title="No document open"
              description="Open a PDF to see the comments it carries."
            />
          ) : (
            <CommentsPanel />
          )
        ) : panel === 'properties' ? (
          activeTab === null ? (
            <EmptyPanelState
              icon={MousePointerSquareDashed}
              title="Nothing selected"
              description="Open a document, then select text, an image, an annotation or a form field."
            />
          ) : editingText ? (
            // While editing, this panel is about whatever is selected on the
            // page: the text, or the image.
            editTarget === 'images' ? (
              <ImageProperties />
            ) : editTarget === 'links' ? (
              <LinkProperties />
            ) : (
              <TextProperties />
            )
          ) : organizing ? (
            // In the page grid this panel is about the page, not the document.
            <PageProperties />
          ) : selected !== null || commenting ? (
            // While commenting, this panel is about the mark being made.
            <AnnotationProperties annotation={selected} />
          ) : (
            <DocumentProperties tab={activeTab} />
          )
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
