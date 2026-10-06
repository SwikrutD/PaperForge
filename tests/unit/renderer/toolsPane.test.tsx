// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, within, type BoundFunctions, type queries } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { RightPanel } from '../../../src/renderer/components/panels/RightPanel';
import {
  initialEditState,
  DEFAULT_VIEW_STATE,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { useAnnotationStore } from '../../../src/renderer/stores/annotationStore';
import { useTextEditStore } from '../../../src/renderer/stores/textEditStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { installBridgeStub, renderWithCommands } from './testUtils';

/**
 * The Tools pane offers the comment tools whenever a document is open —
 * including while the content editor is on — so marking text up does not
 * need the menu.
 */

const tab: DocumentTab = {
  session: {
    id: 's1',
    documentId: 'd1',
    openedAt: new Date().toISOString(),
    dirty: false,
    file: {
      path: 'C:/Docs/Report.pdf',
      displayName: 'Report.pdf',
      sizeBytes: 2048,
      modifiedAt: new Date().toISOString(),
      readOnly: false,
      pdfVersion: '1.7',
      encryptionDetected: false,
    },
  },
  externalChange: null,
  view: DEFAULT_VIEW_STATE,
  edit: initialEditState('s1'),
  pageCount: 1,
};

function pane(): BoundFunctions<typeof queries> {
  return within(screen.getByRole('region', { name: 'Properties and tools' }));
}

beforeEach(() => {
  installBridgeStub({ 'settings:patch': { ok: true, data: DEFAULT_SETTINGS } });
  useDocumentStore.setState({ tabs: [tab], activeId: 's1' });
  useTextEditStore.setState({ active: true });
  useAnnotationStore.setState({ tool: 'select' });
  renderWithCommands(<RightPanel panel="tools" />);
  useUiStore.setState({ commenting: false });
});

describe('the Tools pane while editing', () => {
  it('offers the comment tools', () => {
    for (const name of ['Highlight', 'Underline', 'Strikethrough', 'Sticky note', 'Draw']) {
      expect(pane().getByRole('button', { name })).toBeEnabled();
    }
  });

  it('leaves editing and starts commenting with the tool chosen', async () => {
    await userEvent.click(pane().getByRole('button', { name: 'Highlight' }));

    expect(useTextEditStore.getState().active).toBe(false);
    expect(useUiStore.getState().commenting).toBe(true);
    expect(useAnnotationStore.getState().tool).toBe('highlight');
  });
});
