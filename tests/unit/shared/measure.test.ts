import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DEFAULT_ANNOTATION_STYLE,
  type AnnotationGeometry,
  type AnnotationInput,
  type Measurement,
} from '../../../src/shared/schemas/annotation';
import {
  actualSizeScale,
  calibratedScale,
  formatMeasurement,
  measure,
  pathLength,
  polygonArea,
} from '../../../src/shared/utils/measure';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { threePageDocument } from '../../fixtures/pdf';

const engine = new PdfLibMutationEngine();

/** A drawing at 1 in = 10 ft: 72 points on the paper are 10 feet. */
const TEN_FEET_PER_INCH = calibratedScale(72, 10, 'ft');

function measured(geometry: AnnotationGeometry, measurement: Measurement): AnnotationInput {
  return {
    pageNumber: 1,
    geometry,
    style: { ...DEFAULT_ANNOTATION_STYLE, color: { r: 0.8, g: 0.1, b: 0.1 } },
    contents: '',
    author: 'Tester',
    subject: '',
    measure: measurement,
  };
}

describe('measuring', () => {
  it('measures lengths, paths and areas in points', () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ]),
    ).toBe(50);
  });

  it('measures the page at actual size by default', () => {
    const inches = actualSizeScale('in');
    expect(
      measure(
        'distance',
        [
          { x: 0, y: 0 },
          { x: 144, y: 0 },
        ],
        inches,
      ),
    ).toBe(2);
    expect(
      measure(
        'distance',
        [
          { x: 0, y: 0 },
          { x: 72, y: 0 },
        ],
        actualSizeScale('mm'),
      ),
    ).toBe(25.4);
  });

  it('calibrates from a known length, and squares the scale for an area', () => {
    expect(TEN_FEET_PER_INCH).toEqual({ factor: 10 / 72, unit: 'ft', label: '1 in = 10 ft' });
    if (TEN_FEET_PER_INCH === null) return;

    const square = [
      { x: 0, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 72 },
      { x: 0, y: 72 },
    ];
    expect(measure('area', square, TEN_FEET_PER_INCH)).toBeCloseTo(100, 6);
    expect(formatMeasurement(100, 'area', 'ft')).toBe('100 sq ft');
    expect(calibratedScale(0, 10, 'ft')).toBeNull();
    expect(calibratedScale(72, -1, 'ft')).toBeNull();
  });
});

describe('measurement annotations', () => {
  it('writes a dimension annotation with its scale, value and caption, and reads it back', async () => {
    if (TEN_FEET_PER_INCH === null) throw new Error('scale');
    const result = await engine.apply(threePageDocument(), [
      {
        kind: 'addAnnotations',
        annotations: [
          measured(
            { kind: 'line', from: { x: 100, y: 400 }, to: { x: 244, y: 400 } },
            { kind: 'distance', scale: TEN_FEET_PER_INCH },
          ),
          measured(
            {
              kind: 'polygon',
              vertices: [
                { x: 100, y: 100 },
                { x: 172, y: 100 },
                { x: 172, y: 172 },
                { x: 100, y: 172 },
              ],
            },
            { kind: 'area', scale: TEN_FEET_PER_INCH },
          ),
        ],
      },
    ]);

    const [line, area] = await engine.readAnnotations(result.bytes);
    expect(line).toMatchObject({
      contents: '20 ft',
      measure: { kind: 'distance', scale: { unit: 'ft', label: '1 in = 10 ft' } },
    });
    expect(line?.measure?.scale.factor).toBeCloseTo(10 / 72, 9);
    expect(area).toMatchObject({ contents: '100 sq ft', measure: { kind: 'area' } });

    // In the file: the intent, a rectilinear measure, and a caption drawn in
    // the appearance so a reader that knows nothing of measurements shows it.
    const document = await PDFDocument.load(result.bytes);
    const dict = document.getPage(0).node.Annots()?.lookup(0, PDFDict);
    expect(dict?.lookup(PDFName.of('IT'))).toEqual(PDFName.of('LineDimension'));
    const task = getDocument({ data: new Uint8Array(result.bytes) });
    const pdf = await task.promise;
    const annotations = (await (await pdf.getPage(1)).getAnnotations()) as Array<{
      subtype: string;
      contentsObj: { str: string };
      hasAppearance: boolean;
    }>;
    expect(annotations.map((entry) => [entry.subtype, entry.contentsObj.str])).toEqual([
      ['Line', '20 ft'],
      ['Polygon', '100 sq ft'],
    ]);
    expect(annotations.every((entry) => entry.hasAppearance)).toBe(true);
    await task.destroy();
  });

  it('measures again when the shape is changed, and keeps its scale when moved', async () => {
    if (TEN_FEET_PER_INCH === null) throw new Error('scale');
    const added = await engine.apply(threePageDocument(), [
      {
        kind: 'addAnnotations',
        annotations: [
          measured(
            {
              kind: 'polyline',
              vertices: [
                { x: 0, y: 0 },
                { x: 72, y: 0 },
              ],
            },
            { kind: 'perimeter', scale: TEN_FEET_PER_INCH },
          ),
        ],
      },
    ]);
    const [original] = await engine.readAnnotations(added.bytes);
    if (original === undefined) throw new Error('not written');

    const changed = await engine.apply(added.bytes, [
      {
        kind: 'updateAnnotations',
        updates: [
          {
            id: original.id,
            patch: {
              geometry: {
                kind: 'polyline',
                vertices: [
                  { x: 10, y: 10 },
                  { x: 82, y: 10 },
                  { x: 82, y: 82 },
                ],
              },
            },
          },
        ],
      },
    ]);
    const [after] = await engine.readAnnotations(changed.bytes);
    expect(after).toMatchObject({ contents: '20 ft', measure: { kind: 'perimeter' } });
  });
});
