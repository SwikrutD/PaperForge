// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FindBar } from '../../../src/renderer/components/search/FindBar';
import { DEFAULT_VIEW_STATE, useDocumentStore } from '../../../src/renderer/stores/documentStore';
import type { DocumentSession } from '../../../src/shared/schemas/document';
import {
  EMPTY_RESULTS,
  useSearchStore,
  type SearchHit,
  type SearchResults,
} from '../../../src/renderer/stores/searchStore';
import { seedStores } from './testUtils';

function session(id: string, displayName: string): DocumentSession {
  return {
    id,
    documentId: `doc-${id}`,
    file: {
      path: `C:/Docs/${displayName}`,
      displayName,
      sizeBytes: 1024,
      modifiedAt: '2026-01-01T00:00:00.000Z',
      readOnly: false,
      pdfVersion: '1.7',
      encryptionDetected: false,
    },
    openedAt: '2026-01-01T00:00:00.000Z',
    dirty: false,
  };
}

function hit(sessionId: string, pageNumber: number, excerpt: string): SearchHit {
  return {
    sessionId,
    id: `${sessionId}:${pageNumber}`,
    pageNumber,
    start: 0,
    end: 6,
    excerpt,
    rects: [{ x: 0, y: 0, width: 10, height: 10 }],
  };
}

function openTabs(...ids: string[]): void {
  useDocumentStore.setState({
    tabs: ids.map((id) => ({
      session: session(id, `${id}.pdf`),
      externalChange: null,
      view: { ...DEFAULT_VIEW_STATE },
    })),
    activeId: ids[0] ?? null,
    busy: false,
  });
}

function withResults(results: Partial<SearchResults>): void {
  useSearchStore.setState({
    open: true,
    query: 'invoice',
    results: { ...EMPTY_RESULTS, runKey: 'run', status: 'done', ...results },
  });
}

beforeEach(() => {
  seedStores();
  openTabs('s1');
});

describe('FindBar', () => {
  it('takes the focus when it is opened', () => {
    useSearchStore.getState().openFind();
    render(<FindBar />);
    expect(screen.getByRole('searchbox', { name: 'Find in document' })).toHaveFocus();
  });

  it('reports the position within the matches', () => {
    withResults({ hits: [hit('s1', 1, 'a'), hit('s1', 4, 'b')], currentIndex: 1 });
    render(<FindBar />);
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('says so plainly when nothing matched', () => {
    withResults({ scanned: 3, hits: [] });
    render(<FindBar />);
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('explains a document with no text instead of claiming no matches', () => {
    withResults({ scanned: 3, pagesWithoutText: 3, hits: [] });
    render(<FindBar />);
    expect(
      screen.getByText(
        'These pages carry no text, so there is nothing to search. They are most likely scanned images.',
      ),
    ).toBeInTheDocument();
  });

  it('mentions the pages it could not search', () => {
    withResults({ scanned: 4, pagesWithoutText: 1, hits: [hit('s1', 2, 'a')] });
    render(<FindBar />);
    expect(
      screen.getByText('1 page carries no text and could not be searched.'),
    ).toBeInTheDocument();
  });

  it('steps to the next match', async () => {
    withResults({ hits: [hit('s1', 1, 'a'), hit('s1', 4, 'b')], currentIndex: 0 });
    render(<FindBar />);

    await userEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(useSearchStore.getState().results.currentIndex).toBe(1);

    // And wraps around at the end.
    await userEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(useSearchStore.getState().results.currentIndex).toBe(0);
  });

  it('cannot step through matches that do not exist', () => {
    withResults({ hits: [] });
    render(<FindBar />);
    const next = screen.getByRole('button', { name: 'Next match' });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute('title', 'No matches to step through.');
  });

  it('toggles the search options', async () => {
    withResults({});
    render(<FindBar />);

    await userEvent.click(screen.getByRole('button', { name: 'Match case' }));
    expect(useSearchStore.getState().options.caseSensitive).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Whole words only' }));
    expect(useSearchStore.getState().options.wholeWord).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Highlight all matches' }));
    expect(useSearchStore.getState().highlightAll).toBe(false);
  });

  it('offers other documents only when others are open', async () => {
    withResults({});
    useSearchStore.setState({ optionsExpanded: true });
    render(<FindBar />);

    const allOpen = screen.getByRole('button', { name: 'All open documents' });
    expect(allOpen).toBeDisabled();
    expect(allOpen).toHaveAttribute('title', 'Only one document is open.');

    act(() => {
      openTabs('s1', 's2');
    });
    await userEvent.click(screen.getByRole('button', { name: 'All open documents' }));
    expect(useSearchStore.getState().scope).toBe('allOpen');
  });

  it('shows why a page range could not be read', () => {
    withResults({ rangeError: 'This document has pages 1 to 10.' });
    useSearchStore.setState({ optionsExpanded: true, pageRangeText: '44' });
    render(<FindBar />);

    expect(screen.getByRole('alert')).toHaveTextContent('This document has pages 1 to 10.');
    expect(screen.getByLabelText(/Pages to search/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('lists the results and goes to the one that is clicked', async () => {
    withResults({
      hits: [hit('s1', 2, 'first hit'), hit('s1', 6, 'second hit')],
      currentIndex: 0,
    });
    useSearchStore.setState({ resultsExpanded: true });
    render(<FindBar />);

    await userEvent.click(screen.getByRole('button', { name: /second hit/ }));
    expect(useSearchStore.getState().results.currentIndex).toBe(1);
  });

  it('names the document in the results when several were searched', () => {
    openTabs('s1', 's2');
    withResults({
      hits: [hit('s1', 1, 'here'), hit('s2', 3, 'elsewhere')],
      currentIndex: 0,
    });
    useSearchStore.setState({ resultsExpanded: true, scope: 'allOpen' });
    render(<FindBar />);

    expect(screen.getByText('s1.pdf · page 1')).toBeInTheDocument();
    expect(screen.getByText('s2.pdf · page 3')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    withResults({});
    render(<FindBar />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find in document' }), '{Escape}');
    expect(useSearchStore.getState().open).toBe(false);
  });
});
