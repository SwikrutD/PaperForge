import { useEffect } from 'react';
import { NO_DOCUMENT_REASON } from '../../commands/definitions';
import { useCommands } from '../../commands/useCommands';
import { useUiStore } from '../../stores/uiStore';

/**
 * Starts the tool a reader picked on the home screen before any document was
 * open, once the document they chose has opened.
 *
 * It lives beside the shell rather than in the home screen, which is gone by
 * the time the document arrives. While the command still says only that no
 * document is open it waits; then it runs the tool, or says why it cannot.
 */
export function PendingToolRunner(): null {
  const pending = useUiStore((state) => state.toolAfterOpen);
  const { context, resolve, execute } = useCommands();
  const resolved = pending === null || context === null ? undefined : resolve(pending);

  useEffect(() => {
    if (pending === null || resolved === undefined) return;
    if (!resolved.enabled && resolved.reason === NO_DOCUMENT_REASON) return;

    useUiStore.getState().setToolAfterOpen(null);
    if (resolved.enabled) {
      execute(pending);
    } else {
      useUiStore.getState().showToast({
        title: `${resolved.definition.title} cannot start yet.`,
        description: resolved.reason,
        intent: 'info',
      });
    }
  }, [pending, resolved, execute]);

  return null;
}
