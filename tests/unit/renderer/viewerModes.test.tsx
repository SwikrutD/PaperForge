// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  currentPage,
  layoutPages,
  PAGE_GAP,
  PAGE_MARGIN,
  scaleForMode,
  visiblePages,
} from '../../../src/renderer/components/viewer/viewerLayout';
import {
  rowCount,
  rowIndexOf,
  rowOf,
  stepPage,
} from '../../../src/renderer/components/viewer/pageRows';
import {
  DEFAULT_VIEW_STATE,
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { installBridgeStub, renderWithCommands } from './testUtils';
import { panScroll } from '../../../src/renderer/components/viewer/usePanning';
import {
  anchorAt,
  isClick,
  marqueeRect,
  marqueeScale,
  scrollForAnchor,
} from '../../../src/renderer/components/viewer/marqueeZoom';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { useAnnotationStore } from '../../../src/renderer/stores/annotationStore';
import { fireEvent, render } from '@testing-library/react';
import type { LoadedPdfDocument } from '../../../src/pdf/render/types';
import { PresentationView } from '../../../src/renderer/components/viewer/PresentationView';
import {
  presentationKey,
  presentationTarget,
} from '../../../src/renderer/components/viewer/presentationControls';

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

describe('two-page rows', () => {
  const twoPage = { spread: 'twoPage' as const };

  it('pairs pages one and two, three and four', () => {
    expect(rowOf(1, 5, twoPage)).toEqual([1, 2]);
    expect(rowOf(2, 5, twoPage)).toEqual([1, 2]);
    expect(rowOf(4, 5, twoPage)).toEqual([3, 4]);
    // An odd last page stands alone.
    expect(rowOf(5, 5, twoPage)).toEqual([5]);
    expect(rowCount(5, twoPage)).toBe(3);
  });

  it('steps a pair at a time and stays inside the document', () => {
    expect(stepPage(1, 1, 5, twoPage)).toBe(3);
    expect(stepPage(2, 1, 5, twoPage)).toBe(3);
    expect(stepPage(4, -1, 5, twoPage)).toBe(1);
    expect(stepPage(5, 1, 5, twoPage)).toBe(5);
    expect(stepPage(1, -1, 5, twoPage)).toBe(1);
    expect(stepPage(3, 1, 5, { spread: 'none' })).toBe(4);
  });

  it('works out rows without listing them', () => {
    expect(rowIndexOf(999, twoPage)).toBe(499);
    expect(rowIndexOf(999, { spread: 'none' })).toBe(998);
  });
});

describe('two-page layout', () => {
  const twoPage = { spread: 'twoPage' as const };

  it('places a pair either side of the centre line, like an open book', () => {
    const layout = layoutPages(pages(4), 1, 0, twoPage);
    const [one, two, three] = layout.boxes;
    expect(one).toMatchObject({ top: PAGE_MARGIN, left: -PAGE_GAP / 2 - 600 });
    expect(two).toMatchObject({ top: PAGE_MARGIN, left: PAGE_GAP / 2 });
    expect(three?.top).toBe(PAGE_MARGIN + 800 + PAGE_GAP);
    expect(layout.contentHeight).toBe(PAGE_MARGIN * 2 + 800 * 2 + PAGE_GAP);
    expect(layout.contentWidth).toBe(600 * 2 + PAGE_GAP + PAGE_MARGIN * 2);
  });

  it('makes a row as tall as its tallest page', () => {
    const layout = layoutPages([page(1, 600, 800), page(2, 600, 1000), page(3)], 1, 0, twoPage);
    expect(layout.boxes[2]?.top).toBe(PAGE_MARGIN + 1000 + PAGE_GAP);
  });

  it('reports a row by its first page', () => {
    const layout = layoutPages(pages(6), 1, 0, twoPage);
    expect(currentPage(layout, 0, 900)).toBe(1);
    expect(currentPage(layout, 830, 900)).toBe(3);
  });

  it('mounts both pages of the rows near the view, and no more', () => {
    const layout = layoutPages(pages(1000), 1, 0, twoPage);
    const mounted = visiblePages(layout, 200_000, 900, 900);
    expect(mounted.length % 2).toBe(0);
    expect(mounted.length).toBeLessThanOrEqual(10);
  });

  it('fits two pages across the window', () => {
    const options = { page: page(1), viewportWidth: 1300, viewportHeight: 2000, viewRotation: 0 };
    const scale = scaleForMode('fitWidth', { ...options, columns: 2 });
    expect(scale).toBeCloseTo((1300 - PAGE_MARGIN * 2 - PAGE_GAP) / 2 / 600, 5);
  });
});

describe('two-page view control', () => {
  it('is a named toggle, and next page then moves a pair at a time', async () => {
    let wentTo = 0;
    function Toolbar(): ReactElement {
      const tab = useDocumentStore((store) => store.tabs[0]!);
      return (
        <ViewerToolbar
          tab={tab}
          pageCount={10}
          pageLabels={[]}
          scale={1}
          disabled={false}
          onGoToPage={(pageNumber) => {
            wentTo = pageNumber;
          }}
        />
      );
    }
    renderWithCommands(<Toolbar />);
    const toggle = screen.getByRole('button', { name: 'Two-Page View' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(view().spread).toBe('twoPage');
    expect(screen.getByRole('button', { name: 'Two-Page View' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(wentTo).toBe(3);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });
});

describe('cover page', () => {
  const cover = { spread: 'twoPage' as const, cover: true };

  it('stands the first page alone and pairs two with three', () => {
    expect(rowOf(1, 6, cover)).toEqual([1]);
    expect(rowOf(2, 6, cover)).toEqual([2, 3]);
    expect(rowOf(3, 6, cover)).toEqual([2, 3]);
    expect(rowOf(6, 6, cover)).toEqual([6]);
    expect(rowCount(6, cover)).toBe(4);
    expect(rowCount(1, cover)).toBe(1);
  });

  it('steps from the cover to the first pair and back', () => {
    expect(stepPage(1, 1, 6, cover)).toBe(2);
    expect(stepPage(2, 1, 6, cover)).toBe(4);
    expect(stepPage(3, -1, 6, cover)).toBe(1);
  });

  it('means nothing without two-page view', () => {
    expect(rowOf(2, 6, { spread: 'none', cover: true })).toEqual([2]);
  });

  it('puts the cover on the right of the spine and even pages on the left', () => {
    const layout = layoutPages(pages(4), 1, 0, cover);
    const [one, two, three, four] = layout.boxes;
    expect(one).toMatchObject({ top: PAGE_MARGIN, left: PAGE_GAP / 2 });
    expect(two).toMatchObject({ top: PAGE_MARGIN + 800 + PAGE_GAP, left: -PAGE_GAP / 2 - 600 });
    expect(three).toMatchObject({ top: two?.top, left: PAGE_GAP / 2 });
    // A lone even last page sits on the left.
    expect(four?.left).toBe(-PAGE_GAP / 2 - 600);
    // The content stays symmetrical so the spine is in the middle.
    expect(layout.contentWidth).toBe(600 * 2 + PAGE_GAP + PAGE_MARGIN * 2);
  });

  it('is a named toggle that turns on two-page view', async () => {
    renderWithCommands(<LiveToolbar />);
    const toggle = screen.getByRole('button', { name: 'Show Cover Page' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(view()).toMatchObject({ spread: 'twoPage', coverPage: true });
    expect(screen.getByRole('button', { name: 'Show Cover Page' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Two-Page View' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Turning two-page view off leaves no cover showing.
    fireEvent.click(screen.getByRole('button', { name: 'Two-Page View' }));
    expect(screen.getByRole('button', { name: 'Show Cover Page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('hand tool', () => {
  beforeEach(() => {
    useUiStore.setState({ viewerTool: 'select' });
    useAnnotationStore.setState({ tool: 'select' });
  });

  it('moves the pages with the pointer', () => {
    const start = { left: 100, top: 1000 };
    // Dragging up and to the left shows what is below and to the right.
    expect(panScroll(start, { x: 300, y: 300 }, { x: 250, y: 100 })).toEqual({
      left: 150,
      top: 1200,
    });
    expect(panScroll(start, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual(start);
  });

  it('is a named toggle next to the select tool, each reporting its state', async () => {
    renderWithCommands(<LiveToolbar />);
    const select = screen.getByRole('button', { name: 'Select Tool' });
    const hand = screen.getByRole('button', { name: 'Hand Tool' });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(hand).toHaveAttribute('aria-pressed', 'false');
    expect(hand).toHaveAttribute('title', 'Hand Tool (Ctrl+Shift+H)');

    hand.focus();
    await userEvent.keyboard('{Enter}');
    expect(useUiStore.getState().viewerTool).toBe('hand');
    expect(screen.getByRole('button', { name: 'Hand Tool' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Select Tool' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    screen.getByRole('button', { name: 'Select Tool' }).focus();
    await userEvent.keyboard(' ');
    expect(useUiStore.getState().viewerTool).toBe('select');
  });

  it('turns on and off with Ctrl+Shift+H', async () => {
    renderWithCommands(<LiveToolbar />);
    await userEvent.keyboard('{Control>}{Shift>}h{/Shift}{/Control}');
    expect(useUiStore.getState().viewerTool).toBe('hand');
    await userEvent.keyboard('{Control>}{Shift>}h{/Shift}{/Control}');
    expect(useUiStore.getState().viewerTool).toBe('select');
  });

  it('gives way to a comment tool, and says why it cannot be chosen', () => {
    useUiStore.setState({ viewerTool: 'hand' });
    useAnnotationStore.setState({ tool: 'highlight' });
    renderWithCommands(<LiveToolbar />);
    const hand = screen.getByRole('button', { name: 'Hand Tool' });
    expect(hand).toBeDisabled();
    expect(hand).toHaveAttribute('aria-pressed', 'false');
    expect(hand).toHaveAttribute('title', 'A comment tool has the pages.');
  });
});

describe('marquee zoom', () => {
  beforeEach(() => {
    useUiStore.setState({ viewerTool: 'select' });
    useAnnotationStore.setState({ tool: 'select' });
  });

  const viewport = { width: 1000 + PAGE_MARGIN * 2, height: 600 + PAGE_MARGIN * 2 };

  it('takes the rectangle between two corners, dragged either way', () => {
    expect(marqueeRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      width: 40,
      height: 60,
    });
    expect(isClick(marqueeRect({ x: 5, y: 5 }, { x: 8, y: 7 }))).toBe(true);
  });

  it('zooms so the rectangle fills the window', () => {
    // 200 × 100 in a 1000 × 600 window: width limits it to five times.
    const rect = { left: 0, top: 0, width: 200, height: 100 };
    expect(marqueeScale(1, rect, viewport)).toBeCloseTo(5, 5);
    // A tall rectangle is limited by the height instead.
    expect(marqueeScale(1, { ...rect, width: 100, height: 300 }, viewport)).toBeCloseTo(2, 5);
  });

  it('never zooms past the limits', () => {
    expect(marqueeScale(4, { left: 0, top: 0, width: 10, height: 10 }, viewport)).toBe(10);
  });

  it('zooms a step on a click, and back a step with Shift', () => {
    const click = { left: 100, top: 100, width: 1, height: 1 };
    expect(marqueeScale(1, click, viewport)).toBe(1.25);
    expect(marqueeScale(1, click, viewport, true)).toBe(0.75);
  });

  it('keeps the point it zoomed on in the middle of the window', () => {
    const before = layoutPages(pages(3), 1, 0);
    const point = { x: 640, y: before.boxes[1]!.top + 200 };
    const anchor = anchorAt(before, point, 1200, [1, 2, 3]);
    expect(anchor?.pageNumber).toBe(2);

    const after = layoutPages(pages(3), 3, 0);
    const scroll = scrollForAnchor(after, anchor!, { width: 1200, height: 700 })!;
    // The same spot on page two, now three times as far in, sits mid-window.
    const box = after.boxes[1]!;
    const centre = Math.max(1200, after.contentWidth) / 2;
    expect(scroll.left + 600).toBeCloseTo(centre + box.left + anchor!.x * box.width, 5);
    expect(scroll.top + 350).toBeCloseTo(box.top + 200 * 3, 5);
  });

  it('anchors a point between pages to the nearest one', () => {
    const layout = layoutPages(pages(3), 1, 0);
    const gap = layout.boxes[1]!.top - 4;
    expect(anchorAt(layout, { x: 600, y: gap }, 1200, [1, 2])?.pageNumber).toBe(2);
    expect(anchorAt(layout, { x: 600, y: gap }, 1200, [])).toBeNull();
  });

  it('is a named toggle with its own shortcut, and leaves the hand tool', async () => {
    useUiStore.setState({ viewerTool: 'hand' });
    renderWithCommands(<LiveToolbar />);
    const marquee = screen.getByRole('button', { name: 'Marquee Zoom' });
    expect(marquee).toHaveAttribute('aria-pressed', 'false');
    expect(marquee).toHaveAttribute('title', 'Marquee Zoom (Ctrl+Shift+M)');

    marquee.focus();
    await userEvent.keyboard('{Enter}');
    expect(useUiStore.getState().viewerTool).toBe('marqueeZoom');
    expect(screen.getByRole('button', { name: 'Hand Tool' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.keyboard('{Control>}{Shift>}m{/Shift}{/Control}');
    expect(useUiStore.getState().viewerTool).toBe('select');
  });
});

describe('presentation controls', () => {
  it('answers to the keys a presenter and a clicker use', () => {
    expect(presentationKey('PageDown', false)).toBe('next');
    expect(presentationKey('ArrowRight', false)).toBe('next');
    expect(presentationKey(' ', false)).toBe('next');
    expect(presentationKey(' ', true)).toBe('previous');
    expect(presentationKey('PageUp', false)).toBe('previous');
    expect(presentationKey('Backspace', false)).toBe('previous');
    expect(presentationKey('Home', false)).toBe('first');
    expect(presentationKey('End', false)).toBe('last');
    expect(presentationKey('Escape', false)).toBe('exit');
    expect(presentationKey('q', false)).toBeNull();
  });

  it('stays inside the document', () => {
    expect(presentationTarget('next', 3, 3)).toBe(3);
    expect(presentationTarget('previous', 1, 3)).toBe(1);
    expect(presentationTarget('last', 1, 3)).toBe(3);
    expect(presentationTarget('first', 3, 3)).toBe(1);
  });
});

describe('presentation mode', () => {
  function fakePdf(pageCount: number): LoadedPdfDocument {
    return {
      pages: pages(pageCount),
      renderPage: vi.fn(() => Promise.resolve()),
      renderTextLayer: vi.fn(() => Promise.resolve()),
      getLinks: vi.fn(() => Promise.resolve([])),
    } as unknown as LoadedPdfDocument;
  }

  function present(onExit = vi.fn<(pageNumber: number) => void>()): {
    onExit: typeof onExit;
    pdf: LoadedPdfDocument;
  } {
    const pdf = fakePdf(3);
    function Presenting(): ReactElement {
      const [pageNumber, setPageNumber] = useState(1);
      return (
        <PresentationView
          pdf={pdf}
          fileName="Book.pdf"
          pageNumber={pageNumber}
          rotation={0}
          layersVersion={0}
          onFollowLink={() => undefined}
          onPageChange={setPageNumber}
          onExit={() => {
            onExit(pageNumber);
          }}
        />
      );
    }
    render(<Presenting />);
    return { onExit, pdf };
  }

  it('is a named modal that takes the keyboard and announces the page', () => {
    present();
    const dialog = screen.getByRole('dialog', { name: 'Presenting Book.pdf' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(screen.getByText('Page 1 of 3', { selector: 'p' })).toBeInTheDocument();
  });

  it('shows one page at a time, moving with the keyboard', async () => {
    present();
    expect(document.querySelectorAll('[data-page-number]')).toHaveLength(1);
    await userEvent.keyboard('{PageDown}');
    expect(screen.getByText('Page 2 of 3', { selector: 'p' })).toBeInTheDocument();
    expect(document.querySelector('[data-page-number]')).toHaveAttribute('data-page-number', '2');
    await userEvent.keyboard('{End}');
    expect(screen.getByText('Page 3 of 3', { selector: 'p' })).toBeInTheDocument();
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByText('Page 2 of 3', { selector: 'p' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-page-number]')).toHaveLength(1);
  });

  it('keeps focus on Tab, moves on a click and stops with Escape at the page it reached', async () => {
    const { onExit } = present();
    const dialog = screen.getByRole('dialog', { name: 'Presenting Book.pdf' });
    await userEvent.keyboard('{Tab}');
    expect(dialog).toHaveFocus();
    fireEvent.click(dialog);
    expect(screen.getByText('Page 2 of 3', { selector: 'p' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledWith(2);
  });

  it('is started from a named control with its own shortcut', async () => {
    renderWithCommands(<LiveToolbar />);
    const button = screen.getByRole('button', { name: 'Presentation Mode' });
    expect(button).toHaveAttribute('title', 'Presentation Mode (Ctrl+L)');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.keyboard('{Control>}l{/Control}');
    expect(useUiStore.getState().presentation).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Presentation Mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.keyboard('{Control>}l{/Control}');
    expect(useUiStore.getState().presentation).toBeNull();
  });
});
