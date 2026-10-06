// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import {
  DEFAULT_TEXT_STYLE,
  type TextRunModel,
  type TextStyle,
} from '../../../src/shared/schemas/text';
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
  userUnit: 1,
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

/** The default style at a size. */
function sized(size: number): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, size };
}

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
        textStyle={sized(30)}
        {...handlers}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'New text' })).toHaveStyle({ fontSize: '45px' });
  });
});

describe('the field for existing text', () => {
  // Opening a run sets the style to its own look, so this is the size it is
  // seen at until the reader chooses another.
  it('is drawn at the size chosen for it', () => {
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
        textStyle={sized(16)}
        {...handlers}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveStyle({ fontSize: '32px' });
  });
});

describe('leaving the field', () => {
  function renderOpen(onCommit: () => void): void {
    render(
      <>
        <TextEditLayer
          geometry={geometry}
          scale={1}
          rotation={0}
          runs={[run]}
          selectedId="op3"
          draft="Scaled words"
          placement={null}
          placing={false}
          textStyle={sized(12)}
          {...handlers}
          onCommit={onCommit}
        />
        <section data-keeps-text-draft>
          <label>
            Size
            <input type="number" defaultValue={12} />
          </label>
        </section>
        <button type="button">Somewhere else</button>
      </>,
    );
  }

  it('does not write the text when focus moves to the style controls', () => {
    const onCommit = vi.fn();
    renderOpen(onCommit);
    screen.getByRole('textbox').focus();
    screen.getByRole('spinbutton', { name: 'Size' }).focus();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('writes the text when focus moves anywhere else', () => {
    const onCommit = vi.fn();
    renderOpen(onCommit);
    screen.getByRole('textbox').focus();
    screen.getByRole('button', { name: 'Somewhere else' }).focus();

    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('pointing inside the open field', () => {
  function renderOpen(onBeginEdit: () => void): HTMLElement {
    render(
      <TextEditLayer
        geometry={geometry}
        scale={1}
        rotation={0}
        runs={[run]}
        selectedId="op3"
        draft="Scaled words, being typed"
        placement={null}
        placing={false}
        textStyle={sized(12)}
        {...handlers}
        onBeginEdit={onBeginEdit}
      />,
    );
    return screen.getByRole('textbox');
  }

  it('leaves the press to the field, so the caret can go where it lands', () => {
    const input = renderOpen(vi.fn());
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.pointerDown(input)).toBe(true);
    expect(fireEvent.mouseDown(input)).toBe(true);
  });

  it('does not reopen the run on a click or a double click', () => {
    const onBeginEdit = vi.fn();
    const input = renderOpen(onBeginEdit);
    fireEvent.click(input);
    fireEvent.doubleClick(input);
    expect(onBeginEdit).not.toHaveBeenCalled();
  });
});

describe('the style chosen while typing', () => {
  const chosen: TextStyle = {
    family: 'times',
    bold: true,
    italic: true,
    size: 30,
    color: { r: 1, g: 0, b: 0 },
  };

  function layer(textStyle: TextStyle, placement: boolean): ReactElement {
    return (
      <TextEditLayer
        geometry={geometry}
        scale={2}
        rotation={0}
        runs={[run]}
        selectedId={placement ? null : 'op3'}
        draft="Scaled words"
        placement={placement ? { page: 1, x: 100, y: 200 } : null}
        placing={false}
        textStyle={textStyle}
        {...handlers}
      />
    );
  }

  for (const [what, placement] of [
    ['existing text', false],
    ['new text', true],
  ] as const) {
    it(`shows in the field for ${what} straight away`, () => {
      const { rerender } = render(layer(sized(16), placement));
      rerender(layer(chosen, placement));

      const field = screen.getByRole('textbox');
      expect(field.style).toMatchObject({
        fontSize: '60px',
        fontWeight: 'bold',
        fontStyle: 'italic',
        color: 'rgb(255, 0, 0)',
      });
      expect(field.style.fontFamily).toMatch(/Times/);

      rerender(layer({ ...chosen, size: 40, family: 'courier' }, placement));
      expect(field.style.fontSize).toBe('80px');
      expect(field.style.fontFamily).toMatch(/Courier/);
    });
  }

  it('makes the field tall enough for a size larger than the text was', () => {
    render(layer({ ...chosen, size: 48 }, false));
    // The run is 16 pt high; at 48 pt and a scale of 2 a line is 96 px.
    expect(parseFloat(screen.getByRole('textbox').style.height)).toBeGreaterThanOrEqual(96);
  });
});
