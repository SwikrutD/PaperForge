import { RectangleVertical } from 'lucide-react';
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
  ];
}
