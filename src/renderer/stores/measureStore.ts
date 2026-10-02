import { create } from 'zustand';
import type {
  AnnotationGeometry,
  AnnotationPoint,
  AnnotationStyle,
  MeasurementKind,
  MeasurementScale,
} from '@shared/schemas/annotation';
import {
  actualSizeScale,
  calibratedScale,
  geometryKindFor,
  pathLength,
  type MeasurementUnit,
} from '@shared/utils/measure';
import { useAnnotationStore } from './annotationStore';
import { useAppStore } from './appStore';

/**
 * The measuring tools.
 *
 * A measurement is drawn a click at a time: two clicks for a distance, as
 * many as needed for a perimeter or an area, finished with a double click or
 * Enter. It is written as a real measurement annotation, so it is saved with
 * the document, listed with the comments, and undone like any other change.
 *
 * The scale belongs to the document while it is open. Calibrating sets it
 * from a length the reader knows; every measurement then carries the scale it
 * was made with, so a saved measurement means the same thing tomorrow.
 */

export type MeasureTool = MeasurementKind | 'calibrate';

/** What a measurement looks like: a thin red line with its value beside it. */
export const MEASURE_STYLE: AnnotationStyle = {
  color: { r: 0.8, g: 0.12, b: 0.1 },
  opacity: 1,
  borderWidth: 1.5,
  borderStyle: 'solid',
  fillColor: null,
  fontSize: 10,
  textColor: { r: 0.8, g: 0.12, b: 0.1 },
};

export interface MeasureDraft {
  sessionId: string;
  page: number;
  points: AnnotationPoint[];
}

interface MeasureState {
  active: boolean;
  tool: MeasureTool;
  /** The unit the page is measured in until it is calibrated. */
  unit: MeasurementUnit;
  /** Calibrated scales, by document. */
  scales: Record<string, MeasurementScale>;
  draft: MeasureDraft | null;
  /** A line drawn to calibrate with, waiting for the length it stands for. */
  calibration: { sessionId: string; lengthPoints: number } | null;

  setActive: (active: boolean) => void;
  setTool: (tool: MeasureTool) => void;
  setUnit: (unit: MeasurementUnit) => void;
  addPoint: (sessionId: string, page: number, point: AnnotationPoint) => void;
  removeLastPoint: () => void;
  cancel: () => void;
  /** Finishes the shape being drawn; false when it has too few points. */
  finish: () => Promise<boolean>;
  calibrate: (realLength: number, unit: MeasurementUnit) => boolean;
  cancelCalibration: () => void;
  setScale: (sessionId: string, scale: MeasurementScale | null) => void;
}

/** How many points each tool needs before it can be finished. */
export function pointsNeeded(tool: MeasureTool): number {
  return tool === 'area' ? 3 : 2;
}

/** The scale a document is measured with now. */
export function scaleFor(
  state: Pick<MeasureState, 'scales' | 'unit'>,
  sessionId: string,
): MeasurementScale {
  return state.scales[sessionId] ?? actualSizeScale(state.unit);
}

export const useMeasureStore = create<MeasureState>((set, get) => ({
  active: false,
  tool: 'distance',
  unit: 'in',
  scales: {},
  draft: null,
  calibration: null,

  setActive: (active) => set(active ? { active } : { active, draft: null, calibration: null }),
  setTool: (tool) => set({ tool, draft: null }),
  setUnit: (unit) => set({ unit }),

  addPoint: (sessionId, page, point) => {
    const { draft, tool } = get();
    // A shape belongs to one page; a click on another starts again there.
    const points =
      draft !== null && draft.sessionId === sessionId && draft.page === page
        ? [...draft.points, point]
        : [point];
    set({ draft: { sessionId, page, points } });
    // A distance, and the line a scale is calibrated from, are two clicks.
    if ((tool === 'distance' || tool === 'calibrate') && points.length >= 2) void get().finish();
  },

  removeLastPoint: () => {
    const { draft } = get();
    if (draft === null) return;
    set({
      draft: draft.points.length <= 1 ? null : { ...draft, points: draft.points.slice(0, -1) },
    });
  },

  cancel: () => set({ draft: null }),

  finish: async () => {
    const { draft, tool } = get();
    if (draft === null || draft.points.length < pointsNeeded(tool)) return false;
    set({ draft: null });

    if (tool === 'calibrate') {
      const length = pathLength(draft.points.slice(0, 2));
      if (length <= 0) return false;
      set({ calibration: { sessionId: draft.sessionId, lengthPoints: length } });
      return true;
    }

    const kind = geometryKindFor(tool);
    const geometry: AnnotationGeometry =
      kind === 'line'
        ? {
            kind,
            from: draft.points[0] as AnnotationPoint,
            to: draft.points[1] as AnnotationPoint,
          }
        : { kind, vertices: draft.points };

    await useAnnotationStore.getState().add([
      {
        pageNumber: draft.page,
        geometry,
        style: MEASURE_STYLE,
        contents: '',
        author: authorName(),
        subject: 'Measurement',
        measure: { kind: tool, scale: scaleFor(get(), draft.sessionId) },
      },
    ]);
    return true;
  },

  calibrate: (realLength, unit) => {
    const pending = get().calibration;
    if (pending === null) return false;
    const scale = calibratedScale(pending.lengthPoints, realLength, unit);
    if (scale === null) return false;
    set((state) => ({
      calibration: null,
      scales: { ...state.scales, [pending.sessionId]: scale },
      tool: 'distance',
    }));
    return true;
  },

  cancelCalibration: () => set({ calibration: null }),

  setScale: (sessionId, scale) =>
    set((state) => {
      const scales = { ...state.scales };
      if (scale === null) delete scales[sessionId];
      else scales[sessionId] = scale;
      return { scales, calibration: null };
    }),
}));

/** Who a measurement is signed by: the configured author, or the Windows user. */
function authorName(): string {
  const { settings, appInfo } = useAppStore.getState();
  const configured = settings?.editing.annotationAuthor.trim() ?? '';
  return configured === '' ? (appInfo?.userName ?? 'Unknown') : configured;
}
