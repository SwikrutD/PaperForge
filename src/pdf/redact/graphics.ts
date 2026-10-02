import type { ByteRange, ContentOperation } from '../content/parser';
import { boundsOf } from '../content/images';
import { IDENTITY, applyMatrix, multiply, walkContent, type Matrix } from '../content/state';
import { nameOf, numberOf } from '../content/values';
import {
  boundsOfPoints,
  containedByAny,
  touchesAny,
  transformRect,
  type Point,
  type Rect,
} from './geometry';
import type { ContentEdit } from './text';

/**
 * Pictures, drawings and groups under a mark.
 *
 * A picture wholly under a mark is taken out of the page. One only partly
 * under it is repainted where it can be, so the rest of it stays; where it
 * cannot — a JPEG, say — the page is drawn as a picture instead, because
 * leaving the covered pixels in the file is exactly what redaction must not
 * do. A drawing (a path) wholly under a mark is taken out; one that only
 * crosses the edge is left, painted over, with only its outline beneath.
 */

export type XObjectKind = 'image' | 'form' | 'other';

export interface XObjectInfo {
  kind: XObjectKind;
  /** A form's own box and matrix, which say where it draws. */
  bbox: Rect | null;
  matrix: Matrix | null;
}

export type XObjectResolver = (name: string) => XObjectInfo | undefined;

/** A picture partly under a mark, to be repainted rather than removed. */
export interface Repaint {
  name: string;
  nameRange: ByteRange;
  ctm: Matrix;
}

export interface GraphicsFindings {
  edits: ContentEdit[];
  repaints: Repaint[];
  /** Why the page cannot be cut without becoming a picture. Empty when it can. */
  raster: string[];
  /** Where each affected picture or group was, for saying which mark took it. */
  affected: Rect[];
}

/** Why a partly covered picture cannot be repainted, or null when it can. */
export type RepaintCheck = (name: string) => string | null;

const CONSTRUCTION = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PAINTING = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);

const REASONS = {
  form: 'Part of the page under a mark is drawn as a reusable group, which PaperForge cannot cut into.',
  inline: 'A picture written into the page itself lies partly under a mark.',
} as const;

interface OpenPath {
  start: number;
  points: Point[];
  clips: boolean;
}

export function findGraphics(
  operations: readonly ContentOperation[],
  marks: readonly Rect[],
  resolve: XObjectResolver,
  canRepaint: RepaintCheck,
): GraphicsFindings {
  const findings: GraphicsFindings = { edits: [], repaints: [], raster: [], affected: [] };
  const raster = new Set<string>();
  let path: OpenPath | null = null;

  walkContent(operations, {
    onOperation: ({ operation, index, state }) => {
      const { operator } = operation;

      if (CONSTRUCTION.has(operator)) {
        path ??= { start: operation.range.start, points: [], clips: false };
        path.points.push(...pathPoints(operation, state.ctm));
        return;
      }
      if (operator === 'W' || operator === 'W*') {
        if (path !== null) path.clips = true;
        return;
      }
      if (PAINTING.has(operator)) {
        const finished = path;
        path = null;
        // A path that also sets the clip shapes what comes after it; taking
        // it away could uncover more than it hid.
        if (finished === null || finished.clips || operator === 'n') return;
        if (finished.points.length === 0) return;
        if (containedByAny(marks, boundsOfPoints(finished.points))) {
          findings.edits.push({
            range: { start: finished.start, end: operation.range.end },
            replacement: '',
          });
        }
        return;
      }
      // Anything else ends a path that never painted.
      path = null;

      if (operator === 'ID') {
        const bounds = boundsOf(state.ctm);
        if (!touchesAny(marks, bounds)) return;
        findings.affected.push(bounds);
        const begin = operations[index - 1];
        if (begin?.operator === 'BI' && containedByAny(marks, bounds)) {
          findings.edits.push({ range: begin.range, replacement: '' });
          findings.edits.push({ range: operation.range, replacement: '' });
        } else {
          raster.add(REASONS.inline);
        }
        return;
      }

      if (operator !== 'Do') return;
      const name = nameOf(operation.operands[0]);
      const nameRange = operation.operandRanges[0];
      const info = name === null ? undefined : resolve(name);
      if (name === null || nameRange === undefined || info === undefined) return;

      if (info.kind === 'form' && info.bbox === null) {
        // A group that does not say where it draws could be drawing anywhere.
        raster.add(REASONS.form);
        return;
      }
      const bounds =
        info.kind === 'form' && info.bbox !== null
          ? transformRect(multiply(info.matrix ?? IDENTITY, state.ctm), info.bbox)
          : info.kind === 'image'
            ? boundsOf(state.ctm)
            : null;
      if (bounds === null || !touchesAny(marks, bounds)) return;
      findings.affected.push(bounds);

      if (containedByAny(marks, bounds)) {
        findings.edits.push({ range: operation.range, replacement: '' });
        return;
      }
      if (info.kind === 'form') {
        raster.add(REASONS.form);
        return;
      }

      const problem = canRepaint(name);
      if (problem === null) findings.repaints.push({ name, nameRange, ctm: state.ctm });
      else raster.add(problem);
    },
  });

  findings.raster = [...raster];
  return findings;
}

/** The points a path operator adds, in user space. */
function pathPoints(operation: ContentOperation, ctm: Matrix): Point[] {
  const values = operation.operands.map((operand) => numberOf(operand));
  const pairs = (count: number): Point[] => {
    const points: Point[] = [];
    for (let index = 0; index < count; index += 1) {
      points.push(applyMatrix(ctm, values[index * 2] ?? 0, values[index * 2 + 1] ?? 0));
    }
    return points;
  };

  switch (operation.operator) {
    case 'm':
    case 'l':
      return pairs(1);
    case 'c':
      return pairs(3);
    case 'v':
    case 'y':
      return pairs(2);
    case 're': {
      const [x = 0, y = 0, width = 0, height = 0] = values;
      return [
        applyMatrix(ctm, x, y),
        applyMatrix(ctm, x + width, y),
        applyMatrix(ctm, x, y + height),
        applyMatrix(ctm, x + width, y + height),
      ];
    }
    default:
      return [];
  }
}
