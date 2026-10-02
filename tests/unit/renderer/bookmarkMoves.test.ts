import { describe, expect, it } from 'vitest';
import { find, planMove } from '../../../src/renderer/stores/bookmarkStore';
import type { BookmarkNode } from '../../../src/shared/schemas/bookmark';

function node(path: string, children: BookmarkNode[] = []): BookmarkNode {
  return {
    path,
    title: path,
    page: 1,
    action: 'page',
    style: { bold: false, italic: false, color: null },
    open: true,
    children,
  };
}

// 0 > [0.0, 0.1], 1, 2
const tree = [node('0', [node('0.0'), node('0.1')]), node('1'), node('2')];

describe('bookmark moves', () => {
  it('finds an entry by its position', () => {
    expect(find(tree, '0.1')?.path).toBe('0.1');
    expect(find(tree, '3')).toBeNull();
  });

  it('moves up and down among siblings, with the index read before the move', () => {
    expect(planMove(tree, node('1'), 'up')).toEqual({ parent: null, index: 0, after: '0' });
    expect(planMove(tree, node('1'), 'down')).toEqual({ parent: null, index: 3, after: '2' });
    expect(planMove(tree, node('0'), 'up')).toBeNull();
    expect(planMove(tree, node('2'), 'down')).toBeNull();
  });

  it('nests under the entry above, at the end of its children', () => {
    expect(planMove(tree, node('1'), 'indent')).toEqual({ parent: '0', index: 2, after: '0.2' });
    expect(planMove(tree, node('0.0'), 'indent')).toBeNull();
  });

  it('moves out a level, to just after its parent', () => {
    expect(planMove(tree, node('0.1'), 'outdent')).toEqual({ parent: null, index: 1, after: '1' });
    expect(planMove(tree, node('1'), 'outdent')).toBeNull();
  });
});
