import { Columns2, RectangleVertical } from 'lucide-react';
import type { CommandAvailability, CommandContext, CommandDefinition } from './types';

const documentRequired = (context: CommandContext): boolean | CommandAvailability =>
  context.activeDocument !== null ? true : { enabled: false, reason: 'No document is open.' };

/** How the pages are laid out in the viewer. */
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
  ];
}
