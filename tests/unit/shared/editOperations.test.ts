import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/shared/errors/appError';
import type { EditOperation, EditTransaction } from '../../../src/shared/schemas/edit';
import {
  describeOperation,
  formatPageList,
  normalizePages,
  rotationAfter,
  validateTransaction,
} from '../../../src/pdf/mutate/operations';

function transaction(operations: EditTransaction['operations']): EditTransaction {
  return { label: 'Test', operations };
}

/** The pages a page operation ended up targeting. */
function pagesOf(operation: EditOperation | undefined): number[] | undefined {
  if (operation === undefined) return undefined;
  return operation.kind === 'rotatePages' || operation.kind === 'deletePages'
    ? operation.pages
    : undefined;
}

describe('normalizePages', () => {
  it('sorts, de-duplicates and drops pages the document does not have', () => {
    expect(normalizePages([3, 1, 3, 9, 0, -2], 5)).toEqual([1, 3]);
  });

  it('ignores anything that is not a whole page number', () => {
    expect(normalizePages([1.5, Number.NaN, 2], 5)).toEqual([2]);
  });
});

describe('rotationAfter', () => {
  it('adds a quarter turn and stays within a full circle', () => {
    expect(rotationAfter(0, 90)).toBe(90);
    expect(rotationAfter(270, 90)).toBe(0);
    expect(rotationAfter(180, 270)).toBe(90);
  });

  it('reads a rotation the page already carries', () => {
    expect(rotationAfter(90, 180)).toBe(270);
    // Some documents write a negative rotation.
    expect(rotationAfter(-90, 90)).toBe(0);
  });
});

describe('validateTransaction', () => {
  it('normalizes the pages each operation touches', () => {
    const result = validateTransaction(
      transaction([{ kind: 'rotatePages', pages: [4, 2, 2], degrees: 90 }]),
      10,
    );
    expect(pagesOf(result.operations[0])).toEqual([2, 4]);
    expect(result.pageCount).toBe(10);
  });

  it('counts pages as they are removed, so later operations see the truth', () => {
    const result = validateTransaction(
      transaction([
        { kind: 'deletePages', pages: [1, 2] },
        { kind: 'rotatePages', pages: [1], degrees: 180 },
      ]),
      5,
    );
    expect(result.pageCount).toBe(3);
  });

  it('refuses a change that touches no page of this document', () => {
    expect(() =>
      validateTransaction(transaction([{ kind: 'rotatePages', pages: [99], degrees: 90 }]), 3),
    ).toThrowError(AppError);
  });

  it('refuses to empty a document', () => {
    try {
      validateTransaction(transaction([{ kind: 'deletePages', pages: [1, 2, 3] }]), 3);
      expect.unreachable('deleting every page should be refused');
    } catch (error) {
      expect(AppError.serialize(error).message).toBe('A PDF must keep at least one page.');
    }
  });

  // Page numbers in a later operation mean pages of the document as it is by
  // then, which is the same rule the engine applies.
  it('reads later operations against the pages that are left', () => {
    const result = validateTransaction(
      transaction([
        { kind: 'deletePages', pages: [1] },
        { kind: 'deletePages', pages: [2, 3] },
      ]),
      3,
    );
    // Only page 2 of the two that remained; there is no page 3 any more.
    expect(pagesOf(result.operations[1])).toEqual([2]);
    expect(result.pageCount).toBe(1);
  });

  it('refuses to empty a document across several operations', () => {
    expect(() =>
      validateTransaction(
        transaction([
          { kind: 'deletePages', pages: [1] },
          { kind: 'deletePages', pages: [1, 2] },
        ]),
        3,
      ),
    ).toThrowError(AppError);
  });
});

describe('describeOperation', () => {
  it('says what a change did, for the Undo command', () => {
    expect(describeOperation({ kind: 'rotatePages', pages: [3], degrees: 90 })).toBe(
      'Rotate page 3 right',
    );
    expect(describeOperation({ kind: 'rotatePages', pages: [1, 2], degrees: 270 })).toBe(
      'Rotate pages 1-2 left',
    );
    expect(describeOperation({ kind: 'rotatePages', pages: [5], degrees: 180 })).toBe(
      'Rotate page 5 180°',
    );
    expect(describeOperation({ kind: 'deletePages', pages: [2] })).toBe('Delete page 2');
  });
});

describe('formatPageList', () => {
  it('collapses runs of consecutive pages', () => {
    expect(formatPageList([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
    expect(formatPageList([])).toBe('');
  });
});
