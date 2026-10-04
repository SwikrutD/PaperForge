// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import { ViewerToolbar } from '../../../src/renderer/components/viewer/ViewerToolbar';
import {
  INITIAL_WHEEL_TURN,
  WHEEL_TURN_COOLDOWN_MS,
  WHEEL_TURN_THRESHOLD,
  isolatePages,
  keyTurn,
  wheelTurn,
} from '../../../src/renderer/components/viewer/singlePage';
import { layoutPages, PAGE_MARGIN } from '../../../src/renderer/components/viewer/viewerLayout';
import {
  DEFAULT_VIEW_STATE,
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { installBridgeStub, renderWithCommands } from './testUtils';

function page(pageNumber: number, width = 600, height = 800): PdfPageGeometry {
  return {
    pageNumber,
    width,
    height,
    rotation: 0,
    label: null,
    viewBox: [0, 0, width, height],
    userUnit: 1,
  };
}

const pages = (count: number, width = 600, height = 800): PdfPageGeometry[] =>
  Array.from({ length: count }, (_, index) => page(index + 1, width, height));

function seedTab(): void {
  const tab: DocumentTab = {
    session: {
      id: 's1',
      documentId: 'doc-s1',
      file: {
        path: 'C:/Docs/Book.pdf',
        displayName: 'Book.pdf',
        sizeBytes: 2048,
        modifiedAt: '2026-09-21T10:00:00.000Z',
        readOnly: false,
        pdfVersion: '1.7',
        encryptionDetected: false,
      },
      openedAt: '2026-09-22T09:00:00.000Z',
      dirty: false,
    },
    externalChange: null,
    view: { ...DEFAULT_VIEW_STATE },
    edit: initialEditState('s1'),
    pageCount: 10,
  };
  useDocumentStore.setState({ tabs: [tab], activeId: 's1', busy: false });
}

function view(): DocumentTab['view'] {
  return useDocumentStore.getState().tabs[0]!.view;
}

/** The toolbar as the viewer shows it, following the store. */
function LiveToolbar(): ReactElement {
  const tab = useDocumentStore((store) => store.tabs[0]!);
  return (
    <ViewerToolbar
      tab={tab}
      pageCount={10}
      pageLabels={[]}
      scale={1}
      disabled={false}
      onGoToPage={() => undefined}
    />
  );
}

beforeEach(() => {
  installBridgeStub();
  seedTab();
});

describe('single-page layout', () => {
  it('shows only the chosen page, moved to the top', () => {
    const column = layoutPages(pages(5), 1, 0);
    const single = isolatePages(column, [4]);

    expect(single.boxes[3]?.top).toBe(PAGE_MARGIN);
    expect(single.contentHeight).toBe(800 + PAGE_MARGIN * 2);
    expect(single.contentWidth).toBe(600 + PAGE_MARGIN * 2);
    // Every page can still be looked up by number.
    expect(single.boxes).toHaveLength(5);
  });

  it('is only as tall as the page on show, however long the document', () => {
    const column = layoutPages(pages(1000), 1, 0);
    expect(isolatePages(column, [1000]).contentHeight).toBe(800 + PAGE_MARGIN * 2);
  });

  it('leaves the layout alone when the page does not exist', () => {
    const column = layoutPages(pages(2), 1, 0);
    expect(isolatePages(column, [9])).toBe(column);
  });
});

describe('turning pages with the wheel', () => {
  const middle = { scrollTop: 200, clientHeight: 600, scrollHeight: 1400 };
  const bottom = { scrollTop: 800, clientHeight: 600, scrollHeight: 1400 };
  const top = { scrollTop: 0, clientHeight: 600, scrollHeight: 1400 };

  it('scrolls a tall page before turning it', () => {
    expect(wheelTurn(INITIAL_WHEEL_TURN, 100, middle, 0).turn).toBe(0);
  });

  it('turns once the reader keeps scrolling past the foot of the page', () => {
    const first = wheelTurn(INITIAL_WHEEL_TURN, 100, bottom, 0);
    expect(first.turn).toBe(0);
    const second = wheelTurn(first.state, 100, bottom, 16);
    expect(second.turn).toBe(1);
  });

  it('turns back from the top of the page', () => {
    const result = wheelTurn(INITIAL_WHEEL_TURN, -WHEEL_TURN_THRESHOLD, top, 0);
    expect(result.turn).toBe(-1);
  });

  it('does not race through the document on a touchpad flick', () => {
    let state = wheelTurn(INITIAL_WHEEL_TURN, WHEEL_TURN_THRESHOLD, bottom, 0).state;
    // Momentum keeps arriving; each event inside the cooldown extends it.
    let turns = 0;
    for (let time = 20; time < 2000; time += 20) {
      const result = wheelTurn(state, 30, bottom, time);
      state = result.state;
      if (result.turn !== 0) turns += 1;
    }
    expect(turns).toBe(0);
    // After a pause the next push turns the page again.
    const later = 2000 + WHEEL_TURN_COOLDOWN_MS + 1;
    expect(wheelTurn(state, WHEEL_TURN_THRESHOLD, bottom, later).turn).toBe(1);
  });

  it('starts counting again when the direction changes', () => {
    const down = wheelTurn(INITIAL_WHEEL_TURN, 100, { ...top, scrollHeight: 600 }, 0);
    const up = wheelTurn(down.state, -100, { ...top, scrollHeight: 600 }, 16);
    expect(up.turn).toBe(0);
    expect(up.state.pushed).toBe(-100);
  });
});

describe('turning pages with the keyboard', () => {
  const fits = {
    scrollTop: 0,
    clientHeight: 900,
    scrollHeight: 900,
    scrollWidth: 700,
    clientWidth: 700,
  };
  const tall = { ...fits, scrollHeight: 2000 };

  it('turns with Page Down when the page is scrolled to its foot', () => {
    expect(keyTurn('PageDown', fits)).toBe('next');
    expect(keyTurn('PageDown', tall)).toBeNull();
    expect(keyTurn('PageDown', { ...tall, scrollTop: 1100 })).toBe('next');
  });

  it('turns back with Page Up at the top of the page', () => {
    expect(keyTurn('PageUp', fits)).toBe('previous');
    expect(keyTurn('PageUp', { ...tall, scrollTop: 300 })).toBeNull();
  });

  it('uses the side arrows unless the page scrolls sideways', () => {
    expect(keyTurn('ArrowRight', fits)).toBe('next');
    expect(keyTurn('ArrowLeft', fits)).toBe('previous');
    expect(keyTurn('ArrowRight', { ...fits, scrollWidth: 1400 })).toBeNull();
  });

  it('goes to the first and last page with Home and End', () => {
    expect(keyTurn('Home', tall)).toBe('first');
    expect(keyTurn('End', tall)).toBe('last');
    expect(keyTurn('a', tall)).toBeNull();
  });
});

describe('single-page view control', () => {
  it('is a named toggle button that reports its state', async () => {
    renderWithCommands(<LiveToolbar />);
    const button = screen.getByRole('button', { name: 'Single Page View' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    expect(view().pageMode).toBe('single');
    expect(screen.getByRole('button', { name: 'Single Page View' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('can be reached and switched from the keyboard alone', async () => {
    renderWithCommands(<LiveToolbar />);
    const button = screen.getByRole('button', { name: 'Single Page View' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(view().pageMode).toBe('single');
    await userEvent.keyboard(' ');
    expect(view().pageMode).toBe('continuous');
  });
});
