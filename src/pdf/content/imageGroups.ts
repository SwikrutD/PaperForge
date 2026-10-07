import type { ByteRange, ContentOperation } from './parser';
import { IDENTITY, walkContent, type Matrix } from './state';
import { nameOf } from './values';

/**
 * What an image is drawn together with.
 *
 * A picture is rarely just `/Im Do`. Producers wrap it in `q … Q` with the
 * transform that places it, often a clip that crops it and a transparency
 * state that fades it. Those belong to the picture: moving it without them
 * either leaves the clip behind, cutting the moved picture away, or nests the
 * new drawing inside the old one, so every change is drawn through all the
 * ones before it.
 *
 * And a picture PaperForge adds is wrapped in marked content of its own,
 * `/PFImage << /PFId (…) >> BDC … EMC`, which gives it a name that holds
 * however the rest of the page changes.
 */

/** The marked-content tag PaperForge wraps the images it adds in. */
export const IMAGE_TAG = 'PFImage';

/** What an image id PaperForge gives out looks like. */
export const ADDED_IMAGE_ID = /^pf-[A-Za-z0-9-]{1,40}$/;

export interface ImageGroup {
  /** From the `q` to its `Q`, inclusive. */
  range: ByteRange;
  /** The transform in force at the `q`, which the group's own drawing starts from. */
  ctm: Matrix;
  /** Transparency and other graphics states the group sets, by resource name. */
  states: string[];
}

export interface ImageMark {
  id: string;
  /** From the `BDC` to its `EMC`, inclusive. */
  range: ByteRange;
}

export interface GroupsFound {
  groups: Map<number, ImageGroup>;
  marks: Map<number, ImageMark>;
}

/** Operators that put marks on the page. A clip on its own does not. */
const PAINTING = new Set([
  'S',
  's',
  'f',
  'F',
  'f*',
  'B',
  'B*',
  'b',
  'b*',
  'sh',
  'Do',
  'Tj',
  'TJ',
  "'",
  '"',
  // An inline image paints once, at its `ID`; `BI` only opens its dictionary.
  'ID',
]);

/** Path construction other than a rectangle: a clip PaperForge cannot redraw. */
const PATHS = new Set(['m', 'l', 'c', 'v', 'y', 'h']);

interface Frame {
  start: number;
  ctm: Matrix;
  painted: number;
  /** The image `Do`s inside, by operation index. */
  images: number[];
  /** How deep in `q` the picture is drawn, and each clip inside is set. */
  imageDepth: number;
  clipDepths: number[];
  /** Set when the group holds something it would be wrong to drop. */
  unsafe: boolean;
  states: string[];
}

interface MarkFrame {
  id: string | null;
  start: number;
  images: number[];
}

/**
 * For each image `Do` or inline image `ID` (by operation index), the group it is drawn in and the
 * PaperForge marking around it, where there is one.
 *
 * A group counts only when the picture is the one thing it draws: no other
 * painting, no clip other than rectangles, and no marked content, which may
 * tie the drawing to a structure tree or a layer.
 */
export function findImageGroups(
  operations: readonly ContentOperation[],
  isImage: (index: number) => boolean,
  ctm: Matrix = IDENTITY,
): GroupsFound {
  const groups = new Map<number, ImageGroup>();
  const marks = new Map<number, ImageMark>();
  const frames: Frame[] = [];
  const marked: MarkFrame[] = [];

  walkContent(operations, {
    ctm,
    onOperation: ({ operation, index, state }) => {
      const { operator } = operation;

      if (operator === 'q') {
        frames.push({
          start: operation.range.start,
          ctm: state.ctm,
          painted: 0,
          images: [],
          imageDepth: 0,
          clipDepths: [],
          unsafe: false,
          states: [],
        });
        return;
      }
      if (operator === 'Q') {
        const frame = frames.pop();
        if (frame === undefined) return;
        const [only] = frame.images;
        // The outermost group that holds only the picture wins: an inner one
        // would leave the outer one's clip and transform behind. But a clip
        // set further out than the picture's own level is not its crop — it
        // is not read as one — and dropping it would change the page.
        const ownClips = frame.clipDepths.every((depth) => depth === frame.imageDepth);
        if (only !== undefined && frame.painted === 1 && !frame.unsafe && ownClips) {
          groups.set(only, {
            range: { start: frame.start, end: operation.range.end },
            ctm: frame.ctm,
            states: frame.states,
          });
        }
        return;
      }

      if (operator === 'BDC' || operator === 'BMC') {
        for (const frame of frames) frame.unsafe = true;
        marked.push({
          id: operator === 'BDC' ? markedId(operation) : null,
          start: operation.range.start,
          images: [],
        });
        return;
      }
      if (operator === 'EMC') {
        for (const frame of frames) frame.unsafe = true;
        const mark = marked.pop();
        if (mark?.id != null) {
          for (const image of mark.images) {
            marks.set(image, {
              id: mark.id,
              range: { start: mark.start, end: operation.range.end },
            });
          }
        }
        return;
      }

      if (operator === 'gs') {
        const name = nameOf(operation.operands[0]);
        if (name !== null) for (const frame of frames) frame.states.push(name);
        return;
      }
      if (operator === 'W' || operator === 'W*') {
        for (const frame of frames) frame.clipDepths.push(frames.length);
        return;
      }
      if (PATHS.has(operator)) {
        for (const frame of frames) frame.unsafe = true;
        return;
      }
      if (!PAINTING.has(operator)) return;

      for (const frame of frames) frame.painted += 1;
      if ((operator !== 'Do' && operator !== 'ID') || !isImage(index)) return;
      for (const frame of frames) {
        frame.images.push(index);
        frame.imageDepth = frames.length;
      }
      // Only the innermost PaperForge marking names the picture.
      for (let depth = marked.length - 1; depth >= 0; depth -= 1) {
        const mark = marked[depth];
        if (mark?.id != null) {
          mark.images.push(index);
          break;
        }
      }
    },
  });

  return { groups, marks };
}

/** The id a `/PFImage << /PFId (…) >> BDC` carries, or null for any other. */
function markedId(operation: ContentOperation): string | null {
  if (nameOf(operation.operands[0]) !== IMAGE_TAG) return null;
  const properties = operation.operands[1];
  if (properties?.kind !== 'dict') return null;
  const id = properties.entries.get('PFId');
  if (id?.kind !== 'string') return null;
  const text = String.fromCharCode(...id.bytes);
  return ADDED_IMAGE_ID.test(text) ? text : null;
}
