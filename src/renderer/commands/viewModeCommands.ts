import {
  BookImage,
  Columns2,
  Hand,
  MousePointer2,
  RectangleVertical,
  SquareDashedMousePointer,
} from 'lucide-react';
import type { CommandAvailability, CommandContext, CommandDefinition } from './types';

const documentRequired = (context: CommandContext): boolean | CommandAvailability =>
  context.activeDocument !== null ? true : { enabled: false, reason: 'No document is open.' };

/**
 * The viewer's own pointer tools only apply while no other tool — editing,
 * marking, measuring, drawing a comment — has the pages.
 */
function pagesTakenBy(context: CommandContext): string | null {
  if (context.editingText) return 'Edit PDF has the pages.';
  if (context.filling) return 'Fill & Sign has the pages.';
  if (context.redacting) return 'Redaction has the pages.';
  if (context.cropping) return 'The crop tool has the pages.';
  if (context.measuring) return 'The measuring tools have the pages.';
  if (context.checkingAccessibility) return 'The Accessibility Check has the pages.';
  if (context.annotationTool !== null) return 'A comment tool has the pages.';
  return null;
}

const viewerToolAvailable = (context: CommandContext): boolean | CommandAvailability => {
  const required = documentRequired(context);
  if (required !== true) return required;
  const takenBy = pagesTakenBy(context);
  return takenBy === null ? true : { enabled: false, reason: takenBy };
};

/** The viewer tool in effect: the select tool whenever another tool has the pages. */
function activeViewerTool(context: CommandContext): CommandContext['viewerTool'] {
  return pagesTakenBy(context) === null ? context.viewerTool : 'select';
}

/** How the pages are laid out in the viewer, and how the pointer acts on them. */
export function viewModeCommands(): CommandDefinition[] {
  return [
    {
      id: 'view.singlePage',
      title: 'Single Page View',
      description:
        'Show one page at a time; the wheel and Page Up or Page Down turn pages. ' +
        'Turn it off for continuous scrolling.',
      category: 'view',
      group: 'pageLayout',
      icon: RectangleVertical,
      keywords: ['page layout', 'one page', 'continuous', 'scrolling', 'page at a time'],
      isAvailable: documentRequired,
      isChecked: (context) => context.activeView?.pageMode === 'single',
      run: (context) =>
        context.actions.setPageMode(
          context.activeView?.pageMode === 'single' ? 'continuous' : 'single',
        ),
    },
    {
      id: 'view.twoPage',
      title: 'Two-Page View',
      description: 'Show pages in pairs side by side, like an open book.',
      category: 'view',
      group: 'pageLayout',
      icon: Columns2,
      keywords: ['page layout', 'spread', 'facing pages', 'book', 'side by side'],
      isAvailable: documentRequired,
      isChecked: (context) => context.activeView?.spread === 'twoPage',
      run: (context) =>
        context.actions.setSpread(context.activeView?.spread === 'twoPage' ? 'none' : 'twoPage'),
    },
    {
      id: 'view.coverPage',
      title: 'Show Cover Page',
      description:
        'In two-page view, show the first page on its own so the pairs after it face ' +
        'each other as in a printed book. Turns on two-page view.',
      category: 'view',
      group: 'pageLayout',
      icon: BookImage,
      keywords: ['page layout', 'spread', 'book', 'cover', 'first page alone'],
      isAvailable: documentRequired,
      isChecked: (context) =>
        context.activeView?.spread === 'twoPage' && context.activeView.coverPage,
      run: (context) => {
        const showing = context.activeView?.spread === 'twoPage' && context.activeView.coverPage;
        context.actions.setCoverPage(!showing);
      },
    },
    {
      id: 'view.selectTool',
      title: 'Select Tool',
      description: 'Select and copy text, and follow links.',
      category: 'view',
      group: 'pointer',
      icon: MousePointer2,
      keywords: ['pointer', 'text selection', 'cursor'],
      isAvailable: viewerToolAvailable,
      isChecked: (context) =>
        context.activeDocument !== null && activeViewerTool(context) === 'select',
      run: (context) => context.actions.setViewerTool('select'),
    },
    {
      id: 'view.handTool',
      title: 'Hand Tool',
      description:
        'Drag the pages to move around them. Links still follow on a click. ' +
        'From the keyboard, the arrow keys and Page Up or Page Down move the pages.',
      category: 'view',
      group: 'pointer',
      icon: Hand,
      shortcut: 'Ctrl+Shift+H',
      keywords: ['pan', 'grab', 'drag', 'scroll'],
      isAvailable: viewerToolAvailable,
      isChecked: (context) =>
        context.activeDocument !== null && activeViewerTool(context) === 'hand',
      run: (context) =>
        context.actions.setViewerTool(context.viewerTool === 'hand' ? 'select' : 'hand'),
    },
    {
      id: 'view.marqueeZoom',
      title: 'Marquee Zoom',
      description:
        'Drag a rectangle over the pages to zoom in on it; click to zoom in a step, ' +
        'Shift+click to zoom out. From the keyboard, use Zoom In and Zoom Out.',
      category: 'view',
      group: 'pointer',
      icon: SquareDashedMousePointer,
      shortcut: 'Ctrl+Shift+M',
      keywords: ['zoom', 'rectangle', 'magnify', 'area', 'dynamic zoom'],
      isAvailable: viewerToolAvailable,
      isChecked: (context) =>
        context.activeDocument !== null && activeViewerTool(context) === 'marqueeZoom',
      run: (context) =>
        context.actions.setViewerTool(
          context.viewerTool === 'marqueeZoom' ? 'select' : 'marqueeZoom',
        ),
    },
  ];
}
