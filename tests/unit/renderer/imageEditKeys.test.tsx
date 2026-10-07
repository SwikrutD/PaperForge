// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import {
  useImageEditKeys,
  pastePointFor,
} from '../../../src/renderer/components/edit/useImageEditKeys';
import { useImageEditStore } from '../../../src/renderer/stores/imageEditStore';
import { useEditTargetStore } from '../../../src/renderer/stores/editTargetStore';
import type { PageLayout } from '../../../src/renderer/components/viewer/viewerLayout';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';

/**
 * The keys the image editor answers to: Ctrl+V pastes, Delete deletes, the
 * arrows nudge — and none of them while the reader is typing somewhere.
 */

const actions = {
  paste: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  nudge: vi.fn(),
  commitNudge: vi.fn(() => Promise.resolve()),
  cancelCrop: vi.fn(),
  applyCrop: vi.fn(() => Promise.resolve()),
  select: vi.fn(),
};

function Harness({ editing }: { editing: boolean }): ReactElement {
  useImageEditKeys({
    editing,
    pastePoint: () => ({ page: 3, x: 200, y: 300 }),
    pageRotation: () => 0,
  });
  return <input aria-label="A field" />;
}

function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
  );
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockClear();
  useImageEditStore.setState({ ...actions, selected: null, cropping: null, busy: false });
  useEditTargetStore.setState({ target: 'text' });
});

describe('Ctrl+V', () => {
  it('pastes onto the page in view, and turns to editing images', () => {
    render(<Harness editing />);
    press('v', { ctrlKey: true });

    expect(actions.paste).toHaveBeenCalledWith(3, { x: 200, y: 300 });
    expect(useEditTargetStore.getState().target).toBe('images');
  });

  it('leaves a field the reader is typing in to paste for itself', () => {
    const { getByLabelText } = render(<Harness editing />);
    press('v', { ctrlKey: true }, getByLabelText('A field'));
    expect(actions.paste).not.toHaveBeenCalled();
  });

  it('does nothing outside Edit PDF', () => {
    render(<Harness editing={false} />);
    press('v', { ctrlKey: true });
    expect(actions.paste).not.toHaveBeenCalled();
  });
});

describe('with an image selected', () => {
  beforeEach(() => {
    useEditTargetStore.setState({ target: 'images' });
    useImageEditStore.setState({ selected: { page: 2, id: 'img-4' } });
  });

  it('deletes it with Delete', () => {
    render(<Harness editing />);
    press('Delete');
    expect(actions.remove).toHaveBeenCalledWith(2, 'img-4');
  });

  it('nudges it with the arrows, and writes the nudges when the key comes up', () => {
    render(<Harness editing />);
    press('ArrowRight');
    press('ArrowUp', { shiftKey: true });
    expect(actions.nudge).toHaveBeenNthCalledWith(1, 1, 0);
    expect(actions.nudge).toHaveBeenNthCalledWith(2, 0, 10);
    expect(actions.commitNudge).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
    expect(actions.commitNudge).toHaveBeenCalledTimes(1);
  });

  it('lets go of it with Escape', () => {
    render(<Harness editing />);
    press('Escape');
    expect(actions.select).toHaveBeenCalledWith(2, null);
  });

  it('keeps or abandons a crop with Enter and Escape', () => {
    useImageEditStore.setState({
      cropping: { page: 2, id: 'img-4', crop: { x: 0, y: 0, width: 0.5, height: 1 } },
    });
    render(<Harness editing />);
    press('Enter');
    expect(actions.applyCrop).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(actions.cancelCrop).toHaveBeenCalledTimes(1);
    expect(actions.select).not.toHaveBeenCalled();
  });

  it('leaves the keys to a dialog, and the arrows to a slider', () => {
    const { container } = render(
      <>
        <Harness editing />
        <div role="dialog" aria-label="Settings">
          <button type="button">A button in a dialog</button>
        </div>
        <input type="range" aria-label="Opacity" />
      </>,
    );
    const inDialog = container.querySelector('[role="dialog"] button')!;
    press('Delete', {}, inDialog);
    press('v', { ctrlKey: true }, inDialog);
    press('ArrowRight', {}, container.querySelector('input[type="range"]')!);

    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.paste).not.toHaveBeenCalled();
    expect(actions.nudge).not.toHaveBeenCalled();
  });

  it('leaves the keys alone while editing text', () => {
    useEditTargetStore.setState({ target: 'text' });
    render(<Harness editing />);
    press('Delete');
    press('ArrowLeft');
    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.nudge).not.toHaveBeenCalled();
  });
});

describe('where a paste lands', () => {
  const geometry = {
    pageNumber: 2,
    width: 600,
    height: 800,
    rotation: 0,
    viewBox: [0, 0, 600, 800],
    userUnit: 1,
  } as unknown as PdfPageGeometry;
  const layout = {
    boxes: [
      { top: 0, left: -300, width: 600, height: 800 },
      { top: 820, left: -300, width: 600, height: 800 },
    ],
    contentWidth: 600,
    contentHeight: 1640,
  } as unknown as PageLayout;

  it('is the point of the page in the middle of the window', () => {
    // Scrolled so the window's middle is 100 px into the second page.
    const point = pastePointFor({
      layout,
      scroll: { left: 0, top: 520 },
      viewport: { width: 600, height: 800 },
      candidates: [1, 2],
      geometryOf: () => geometry,
      scale: 1,
      rotation: 0,
    });
    expect(point).toEqual({ page: 2, x: 300, y: 700 });
  });

  it('is kept on the page when the middle of the window is between pages', () => {
    const point = pastePointFor({
      layout,
      scroll: { left: 0, top: 410 },
      viewport: { width: 600, height: 800 },
      candidates: [1, 2],
      geometryOf: () => geometry,
      scale: 1,
      rotation: 0,
    });
    expect(point?.page).toBe(1);
    expect(point?.y).toBe(0);
  });
});
