// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DocumentSession } from '../../../src/shared/schemas/document';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { HomeScreen } from '../../../src/renderer/components/home/HomeScreen';
import { PendingToolRunner } from '../../../src/renderer/components/home/PendingToolRunner';
import { useCreateStore } from '../../../src/renderer/stores/createStore';
import { useDocumentStore } from '../../../src/renderer/stores/documentStore';
import { useTextEditStore } from '../../../src/renderer/stores/textEditStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { installBridgeStub, renderWithCommands } from './testUtils';

/**
 * The home screen is where a reader starts: it offers to open or create a
 * document, and a tool that works on a document asks for one rather than
 * sitting there greyed out.
 */

const session: DocumentSession = {
  id: 'session-1',
  documentId: 'doc-1',
  file: {
    path: 'C:/Docs/Report.pdf',
    displayName: 'Report.pdf',
    sizeBytes: 2048,
    modifiedAt: new Date().toISOString(),
    readOnly: false,
    pdfVersion: '1.7',
    encryptionDetected: false,
  },
  openedAt: new Date().toISOString(),
  dirty: false,
};

function opened(sessions: DocumentSession[]): unknown {
  return { ok: true, data: { sessions, failures: [], canceled: sessions.length === 0 } };
}

/** The IPC channels a stubbed bridge was asked for. */
function channels(invoke: { mock: { calls: unknown[][] } }): unknown[] {
  return invoke.mock.calls.map((call) => call[0]);
}

/** Settings writes answer as the main process would. */
function stub(responses: Record<string, unknown> = {}): ReturnType<typeof installBridgeStub> {
  return installBridgeStub({
    'settings:patch': { ok: true, data: DEFAULT_SETTINGS },
    ...responses,
  });
}

function renderHome(): void {
  renderWithCommands(
    <>
      <HomeScreen recentFiles={[]} />
      <PendingToolRunner />
    </>,
  );
}

beforeEach(() => {
  useDocumentStore.setState({ tabs: [], activeId: null });
  useTextEditStore.setState({ active: false });
  useCreateStore.setState({ open: false });
});

describe('starting points', () => {
  it('offers to open a PDF', async () => {
    const bridge = stub({ 'files:openDialog': opened([]) });
    renderHome();

    await userEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
    expect(channels(bridge.invoke)).toContain('files:openDialog');
  });

  it('offers to create a PDF', async () => {
    stub();
    renderHome();

    await userEvent.click(screen.getByRole('button', { name: 'Create PDF' }));
    expect(useCreateStore.getState().open).toBe(true);
  });
});

describe('a tool that works on a document', () => {
  it('can be clicked with no document open, and asks for one', async () => {
    const bridge = stub({ 'files:openDialog': opened([]) });
    renderHome();

    const edit = screen.getByRole('button', { name: /Edit PDF/ });
    expect(edit).toBeEnabled();
    await userEvent.click(edit);
    expect(channels(bridge.invoke)).toContain('files:openDialog');
  });

  it('starts once the chosen document is open', async () => {
    stub({ 'files:openDialog': opened([session]) });
    renderHome();

    await userEvent.click(screen.getByRole('button', { name: /Edit PDF/ }));
    await waitFor(() => expect(useTextEditStore.getState().active).toBe(true));
  });

  it('does not start later when the picker was cancelled', async () => {
    stub({ 'files:openDialog': opened([]) });
    renderHome();

    await userEvent.click(screen.getByRole('button', { name: /Edit PDF/ }));
    await waitFor(() => expect(useUiStore.getState().toolAfterOpen).toBeNull());
    expect(useTextEditStore.getState().active).toBe(false);
  });
});

describe('what the home screen says', () => {
  it('does not call working tools "not part of this build"', () => {
    stub();
    renderHome();
    expect(screen.queryByText(/not part of this build/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/greyed out/i)).not.toBeInTheDocument();
  });
});
