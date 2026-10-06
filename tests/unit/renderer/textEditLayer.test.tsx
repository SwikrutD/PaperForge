// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import type { TextRunModel } from '../../../src/shared/schemas/text';
import { TextEditLayer } from '../../../src/renderer/components/edit/TextEditLayer';

/**
 * The text editor's fields are drawn at the size the text will appear at, so
 * what is typed looks like what will be written.
 */

const geometry: PdfPageGeometry = {
  pageNumber: 1,
  width: 612,
  height: 792,
  rotation: 0,
  viewBox: [0, 0, 612, 792],
  label: null,
} as unknown as PdfPageGeometry;

const run: TextRunModel = {
  id: 'op3',
  text: 'Scaled words',
  x: 60,
  y: 696,
  width: 120,
  height: 16,
  baselineX: 60,
  baselineY: 700,
  rotation: 0,
  fontName: 'F1',
  baseFont: 'Helvetica',
  fontSize: 16,
  color: { r: 0, g: 0, b: 0 },
  invisible: false,
  editable: true,
  reason: null,
  replaced: false,
};

const noop = vi.fn();
const handlers = {
  onSelect: noop,
  onBeginEdit: noop,
  onPlace: noop,
  onDraft: noop,
  onCommit: noop,
  onCancel: noop,
};

describe('the field for new text', () => {
  it('is drawn at the size the text will be written at', () => {
    render(
      <TextEditLayer
        geometry={geometry}
        scale={1.5}
        rotation={0}
        runs={[]}
        selectedId={null}
        draft=""
        placement={{ page: 1, x: 100, y: 200 }}
        placing={false}
        newTextSize={30}
        {...handlers}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'New text' })).toHaveStyle({ fontSize: '45px' });
  });
});

describe('the field for existing text', () => {
  it('is drawn at the size the run is seen at', () => {
    render(
      <TextEditLayer
        geometry={geometry}
        scale={2}
        rotation={0}
        runs={[run]}
        selectedId="op3"
        draft="Scaled words"
        placement={null}
        placing={false}
        newTextSize={12}
        {...handlers}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveStyle({ fontSize: '32px' });
  });
});
