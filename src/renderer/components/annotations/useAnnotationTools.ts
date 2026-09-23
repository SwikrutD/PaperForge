import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type {
  Annotation,
  AnnotationGeometry,
  AnnotationInput,
  StampImage,
  TEXT_MARKUP_KINDS,
} from '@shared/schemas/annotation';

/** The four kinds a text selection can be marked with. */
type TextMarkupKind = (typeof TEXT_MARKUP_KINDS)[number];
import { describeKind } from '@pdf/mutate/operations';
import { useAppStore } from '../../stores/appStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { isMarkupTool } from './annotationDrawing';

import { useTextMarkup, type MarkupSelection } from './useTextMarkup';

/**
 * What the comment tools do when the reader uses them.
 *
 * The viewer owns the pages and the scale; this hook owns what a gesture
 * means, so the viewer component stays about laying pages out.
 */
export function useAnnotationTools(
  sessionId: string,
  revision: number,
  pages: readonly PdfPageGeometry[],
  scale: number,
  rotation: number,
): {
  tool: ReturnType<typeof useAnnotationStore.getState>['tool'];
  create: (geometry: AnnotationGeometry, pageNumber: number) => void;
  move: (annotation: Annotation, geometry: AnnotationGeometry) => void;
  erase: (annotation: Annotation) => void;
  commitDraft: (contents: string) => void;
  cancelDraft: () => void;
  stampImage: StampImage | null;
} {
  const tool = useAnnotationStore((state) => state.tool);
  const style = useAnnotationStore((state) => state.style);
  const stampLabel = useAnnotationStore((state) => state.stampLabel);
  const draft = useAnnotationStore((state) => state.draft);
  const settings = useAppStore((state) => state.settings);
  const appInfo = useAppStore((state) => state.appInfo);

  const [staged, setStaged] = useState<{ tool: string; image: StampImage | null }>({
    tool: 'select',
    image: null,
  });
  // The image belongs to the image stamp tool: picking another tool drops it
  // without needing an effect to clear it.
  const stampImage = staged.tool === tool ? staged.image : null;

  // The author a new comment is signed with: what the reader set, or who is
  // signed in to Windows.
  const author = useMemo(() => {
    const configured = settings?.editing.annotationAuthor.trim() ?? '';
    return configured === '' ? (appInfo?.userName ?? 'Unknown') : configured;
  }, [settings, appInfo]);

  // Annotations come from the document, so they are re-read whenever the
  // document changes underneath — including after undo.
  useEffect(() => {
    void useAnnotationStore.getState().load(sessionId, revision);
  }, [sessionId, revision]);

  // Choosing the image stamp tool asks for the picture first: there is nothing
  // to place until one has been chosen.
  useEffect(() => {
    if (tool !== 'imageStamp') return;
    let cancelled = false;
    void useAnnotationStore
      .getState()
      .pickStampImage()
      .then((image) => {
        if (cancelled) return;
        setStaged({ tool: 'imageStamp', image });
        // Nothing was chosen, so there is nothing to place.
        if (image === null) useAnnotationStore.getState().setTool('select');
      });
    return () => {
      cancelled = true;
    };
  }, [tool]);

  const inputFor = useCallback(
    (geometry: AnnotationGeometry, pageNumber: number, contents = ''): AnnotationInput => ({
      pageNumber,
      geometry,
      style,
      contents,
      author,
      subject: '',
      ...(geometry.kind === 'stamp' ? { stampLabel } : {}),
      ...(geometry.kind === 'imageStamp' && stampImage !== null
        ? { imageToken: stampImage.token }
        : {}),
    }),
    [style, author, stampLabel, stampImage],
  );

  const create = useCallback(
    (geometry: AnnotationGeometry, pageNumber: number) => {
      const store = useAnnotationStore.getState();

      // A text box and a callout are typed into before they are written.
      if (geometry.kind === 'freeText' || geometry.kind === 'callout') {
        store.setDraft(inputFor(geometry, pageNumber));
        return;
      }
      void store.add([inputFor(geometry, pageNumber)]);
    },
    [inputFor],
  );

  const move = useCallback((annotation: Annotation, geometry: AnnotationGeometry) => {
    void useAnnotationStore
      .getState()
      .update(annotation.id, { geometry }, `Move ${describeKind(annotation.geometry.kind)}`);
  }, []);

  const erase = useCallback((annotation: Annotation) => {
    void useAnnotationStore.getState().remove([annotation.id]);
  }, []);

  const commitDraft = useCallback((contents: string) => {
    const store = useAnnotationStore.getState();
    const pending = store.draft;
    if (pending === null) return;
    if (contents.trim() === '') {
      // An empty box is not worth writing into the document.
      store.setDraft(null);
      store.setTool('select');
      return;
    }
    void store.add([{ ...pending, contents }]);
    store.setTool('select');
  }, []);

  const cancelDraft = useCallback(() => {
    const store = useAnnotationStore.getState();
    store.setDraft(null);
    store.setTool('select');
  }, []);

  // Text markup is made from the selection rather than from a drag.
  const markupKind = markupKindOf(tool);
  const onSelection = useCallback(
    (selections: MarkupSelection[]) => {
      if (markupKind === null) return;
      const inputs = selections.map((selection) =>
        inputFor({ kind: markupKind, quads: selection.quads }, selection.pageNumber),
      );
      if (inputs.length > 0) void useAnnotationStore.getState().add(inputs);
    },
    [markupKind, inputFor],
  );

  useTextMarkup(markupKind !== null && draft === null, pages, scale, rotation, onSelection);

  return { tool, create, move, erase, commitDraft, cancelDraft, stampImage };
}

/** The markup kind a tool marks text with, or null when it does not. */
function markupKindOf(tool: string): TextMarkupKind | null {
  return isMarkupTool(tool) ? (tool as TextMarkupKind) : null;
}
