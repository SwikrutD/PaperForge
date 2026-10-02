import { useMemo } from 'react';
import type { EditOperation } from '@shared/schemas/edit';
import type { PageLabelStyle, SplitPart } from '@shared/schemas/pages';
import { cropOperations, ZERO_MARGINS, type CropMargins } from '@shared/utils/cropBoxes';
import { describeOperation } from '@pdf/mutate/operations';
import { useOrganizeStore } from '../../stores/organizeStore';
import { formatPageRange } from '@shared/utils/pageRange';
import { allPages, orderAfterMove } from './organizeSelection';

export type { CropMargins };

/** What the organize toolbar and its dialogs can ask for. */
export interface OrganizeActions {
  /** Pages chosen right now, in page order. */
  readonly pages: number[];
  /** Where new pages land: after the last chosen page, or at the end. */
  readonly insertIndex: number;
  rotate: (direction: 1 | -1) => void;
  remove: () => void;
  duplicate: () => void;
  move: (pages: number[], toIndex: number) => void;
  insertBlank: () => void;
  insertFromPdf: () => void;
  insertImage: () => void;
  replaceSelectedPage: () => void;
  moveToDocument: (targetSessionId: string) => void;
  /** Crops pages by insetting what each one currently shows. */
  crop: (pages: number[], margins: CropMargins, target: 'crop' | 'media') => void;
  /** Puts the crop box back to the whole page. */
  resetCrop: (pages: number[]) => void;
  extract: (mode: 'single' | 'perPage', deleteAfter: boolean) => void;
  split: (parts: SplitPart[]) => void;
  renumber: (style: PageLabelStyle, prefix: string, start: number) => void;
}

function describeCount(count: number): string {
  return `${String(count)} page${count === 1 ? '' : 's'}`;
}

/**
 * The page operations the organize workspace performs.
 *
 * Each one is composed here and handed to the document store, so the toolbar
 * and the dialogs never build a transaction themselves and every change is one
 * undoable step.
 */
export function useOrganizeActions(pageCount: number, baseName: string): OrganizeActions {
  const selection = useOrganizeStore((state) => state.selection);
  const store = useOrganizeStore;

  return useMemo<OrganizeActions>(() => {
    const pages = selection.pages.filter((page) => page >= 1 && page <= pageCount);
    const last = pages[pages.length - 1];
    const insertIndex = last ?? pageCount;

    const apply = (label: string, operations: EditOperation[]): void => {
      void store.getState().apply(label, operations);
    };
    const one = (operation: EditOperation): void => {
      apply(describeOperation(operation), [operation]);
    };

    return {
      pages,
      insertIndex,

      rotate: (direction) => {
        if (pages.length === 0) return;
        one({ kind: 'rotatePages', pages, degrees: direction === 1 ? 90 : 270 });
      },

      remove: () => {
        void store.getState().deletePages(pages, pageCount);
      },

      duplicate: () => {
        if (pages.length === 0) return;
        one({ kind: 'duplicatePages', pages });
      },

      move: (moving, toIndex) => {
        const operation = { kind: 'movePages' as const, pages: moving, toIndex };
        // The pages stay chosen where they land, so they can be picked up again.
        const landed = orderAfterMove(allPages(pageCount), moving, toIndex);
        const chosen = moving.map((page) => landed.indexOf(page) + 1).sort((a, b) => a - b);
        void (async (): Promise<void> => {
          await store.getState().apply(describeOperation(operation), [operation]);
          store.getState().setSelection({ pages: chosen, anchor: chosen[0] ?? null });
        })();
      },

      insertBlank: () => {
        one({ kind: 'insertBlankPages', atIndex: insertIndex, count: 1, size: null });
      },

      insertFromPdf: () => {
        void (async (): Promise<void> => {
          const source = await store.getState().chooseSource('pdf');
          if (source === null || source.kind !== 'pdf') return;
          apply(`Insert pages from ${source.fileName}`, [
            { kind: 'insertPages', atIndex: insertIndex, token: source.token, pages: null },
          ]);
        })();
      },

      insertImage: () => {
        void (async (): Promise<void> => {
          const source = await store.getState().chooseSource('image');
          if (source === null || source.kind !== 'image') return;
          apply(`Insert ${source.fileName} as a page`, [
            {
              kind: 'insertImagePages',
              atIndex: insertIndex,
              token: source.token,
              size: null,
              margin: 36,
            },
          ]);
        })();
      },

      replaceSelectedPage: () => {
        const page = pages[0];
        if (page === undefined || pages.length !== 1) return;
        void (async (): Promise<void> => {
          const source = await store.getState().chooseSource('pdf');
          if (source === null || source.kind !== 'pdf') return;
          // The new pages go in ahead of the old one, which is why the page to
          // remove has moved down by however many arrived.
          apply(`Replace page ${String(page)} with ${source.fileName}`, [
            { kind: 'insertPages', atIndex: page - 1, token: source.token, pages: null },
            { kind: 'deletePages', pages: [page + source.pageCount] },
          ]);
        })();
      },

      moveToDocument: (targetSessionId) => {
        void store.getState().moveToDocument(targetSessionId, pages, pageCount);
      },

      crop: (cropPages, margins, target) => {
        const boxes = store.getState().boxes;
        // Margins inset what the page shows now, except when the page itself
        // is being resized, which is measured from the page.
        const operations = cropOperations(
          boxes,
          cropPages,
          margins,
          target,
          target === 'media' ? 'media' : 'crop',
        );
        if (operations.length === 0) return;
        apply(
          target === 'media'
            ? `Resize ${describeCount(cropPages.length)}`
            : `Crop ${describeCount(cropPages.length)}`,
          operations,
        );
      },

      resetCrop: (cropPages) => {
        const boxes = store.getState().boxes;
        const operations = cropOperations(boxes, cropPages, ZERO_MARGINS, 'crop', 'media');
        if (operations.length === 0) return;
        apply(`Reset the crop of ${describeCount(cropPages.length)}`, operations);
      },

      extract: (mode, deleteAfter) => {
        if (pages.length === 0) return;
        void (async (): Promise<void> => {
          const parts: SplitPart[] =
            mode === 'single'
              ? [{ name: `${baseName} ${formatPageRange(pages)}.pdf`, pages }]
              : pages.map((page) => ({ name: `${baseName} ${String(page)}.pdf`, pages: [page] }));

          const written = await store.getState().exportPages(parts, mode);
          // Pages only leave the document once they are safely somewhere else.
          if (written > 0 && deleteAfter) await store.getState().deletePages(pages, pageCount);
        })();
      },

      split: (parts) => {
        if (parts.length === 0) return;
        void store.getState().exportPages(parts, 'perPage');
      },

      renumber: (style, prefix, start) => {
        const from = pages[0] ?? 1;
        void store.getState().setLabels(from, style, prefix, start);
      },
    };
  }, [selection, pageCount, baseName, store]);
}
