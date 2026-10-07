// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import { DEFAULT_ANNOTATION_STYLE, type Annotation } from '../../../src/shared/schemas/annotation';
import type { EditTransaction } from '../../../src/shared/schemas/edit';
import { AnnotationLayer } from '../../../src/renderer/components/annotations/AnnotationLayer';
import { useAnnotationStore } from '../../../src/renderer/stores/annotationStore';
import {
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';

/**
 * A stamp or signature PaperForge made can be resized from its corners, turned
 * from the handle above it, and duplicated; one made elsewhere is only moved.
 */

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
vi.mock('../../../src/renderer/services/ipcClient', () => ({
  invoke,
  subscribe: vi.fn(() => () => undefined),
}));

const geometry = {
  pageNumber: 1,
  width: 600,
  height: 800,
  rotation: 0,
  viewBox: [0, 0, 600, 800],
  userUnit: 1,
  label: null,
} as unknown as PdfPageGeometry;

const own: Annotation = {
  id: 'pf-stamp',
  pageNumber: 1,
  geometry: { kind: 'stamp', rect: { x: 100, y: 200, width: 80, height: 40 } },
  style: { ...DEFAULT_ANNOTATION_STYLE, borderWidth: 0 },
  contents: '',
  author: 'Tester',
  subject: '',
  stampLabel: 'Approved',
  createdAt: null,
  modifiedAt: null,
  resolved: false,
  editable: true,
};

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
  });
});

function renderLayer(annotation: Annotation): {
  container: HTMLElement;
  onTransform: ReturnType<typeof vi.fn>;
  onDuplicate: ReturnType<typeof vi.fn>;
} {
  const onTransform = vi.fn();
  const onDuplicate = vi.fn();
  const { container } = render(
    <AnnotationLayer
      geometry={geometry}
      scale={1}
      rotation={0}
      annotations={[annotation]}
      tool="select"
      selectedId={annotation.id}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onMove={vi.fn()}
      onErase={vi.fn()}
      onTransform={onTransform}
      onDuplicate={onDuplicate}
      draft={null}
    />,
  );
  return { container, onTransform, onDuplicate };
}

function drag(
  element: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  shiftKey = false,
): void {
  fireEvent.pointerDown(element, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  fireEvent.pointerMove(element, { clientX: to.x, clientY: to.y, pointerId: 1, shiftKey });
  fireEvent.pointerUp(element, { clientX: to.x, clientY: to.y, pointerId: 1, shiftKey });
}

describe('a stamp PaperForge made, selected', () => {
  it('grows from a corner and keeps its shape', () => {
    const { container, onTransform } = renderLayer(own);
    // The top right corner is at (180, 560) on screen.
    drag(
      container.querySelector('[data-stamp-handle="Top right"]')!,
      { x: 180, y: 560 },
      { x: 220, y: 560 },
    );

    expect(onTransform).toHaveBeenCalledTimes(1);
    const [annotation, rect, rotation] = onTransform.mock.calls[0] as [
      Annotation,
      { x: number; y: number; width: number; height: number },
      number,
    ];
    expect(annotation.id).toBe('pf-stamp');
    expect(rect.width).toBeCloseTo(120, 6);
    expect(rect.height).toBeCloseTo(60, 6);
    expect(rotation).toBe(0);
  });

  it('turns from the handle above it, in steps of 15° with Shift', () => {
    const { container, onTransform } = renderLayer(own);
    // The middle is at (140, 580); swing from above it to its left.
    drag(
      container.querySelector('[data-stamp-handle="Rotate"]')!,
      { x: 140, y: 520 },
      { x: 80, y: 583 },
      true,
    );

    const [, rect, rotation] = onTransform.mock.calls[0] as [Annotation, { width: number }, number];
    expect(rotation).toBe(90);
    expect(rect.width).toBe(80);
  });

  it('is framed turned, as it is drawn', () => {
    const { container } = renderLayer({ ...own, rotation: 30 });
    const frame = container.querySelector<HTMLElement>('[data-stamp-frame]')!;
    expect(frame.style.transform).toBe('rotate(-30deg)');
  });

  it('offers to duplicate it', () => {
    const { container, onDuplicate } = renderLayer(own);
    fireEvent.click(container.querySelector('[aria-label="Duplicate"]')!);
    expect(onDuplicate).toHaveBeenCalledWith(own);
  });
});

describe('a stamp made elsewhere', () => {
  it('has no handles: PaperForge can move it but not redraw it', () => {
    const { container } = renderLayer({ ...own, id: 'foreign-1' });
    expect(container.querySelector('[data-stamp-handle]')).toBeNull();
    expect(container.querySelector('[aria-label="Duplicate"]')).toBeNull();
  });
});

describe('duplicating', () => {
  let applied: EditTransaction[];

  beforeEach(() => {
    applied = [];
    const tab = { session: { id: 's1' }, edit: initialEditState('s1') } as unknown as DocumentTab;
    useDocumentStore.setState({
      tabs: [tab],
      activeId: 's1',
      applyEdit: (_session: string, transaction: EditTransaction) => {
        applied.push(transaction);
        // A written change is a new revision.
        useDocumentStore.setState((state) => ({
          tabs: state.tabs.map((entry) => ({
            ...entry,
            edit: { ...entry.edit, revision: entry.edit.revision + 1 },
          })),
        }));
        return Promise.resolve();
      },
    });
    useAnnotationStore.setState({ annotations: [own], selectedId: own.id });
  });

  it('copies it a little way off as one change, and selects the copy', async () => {
    await useAnnotationStore.getState().duplicate(own.id);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.label).toBe('Duplicate stamp');
    const operation = applied[0]?.operations[0];
    expect(operation).toMatchObject({ kind: 'duplicateAnnotations', dx: 12, dy: -12 });
    const copy = operation?.kind === 'duplicateAnnotations' ? operation.copies[0] : undefined;
    expect(copy?.id).toBe(own.id);
    expect(copy?.newId).toMatch(/^pf-/);
    expect(useAnnotationStore.getState().selectedId).toBe(copy?.newId);
  });

  it('turns and resizes it as one change', async () => {
    await useAnnotationStore
      .getState()
      .transform(own.id, { x: 90, y: 190, width: 100, height: 50 }, 45);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.operations[0]).toEqual({
      kind: 'updateAnnotations',
      updates: [
        {
          id: own.id,
          patch: {
            geometry: { kind: 'stamp', rect: { x: 90, y: 190, width: 100, height: 50 } },
            rotation: 45,
          },
        },
      ],
    });
  });
});
