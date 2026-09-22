import type { ReactElement } from 'react';
import type { ConfirmationRequest } from '../../types/ui';
import { useUiStore } from '../../stores/uiStore';
import { Button } from '../controls/Button';
import { Dialog } from './Dialog';

/**
 * Asks before something cannot be undone. Cancel is the default action, so
 * dismissing the dialog — with Escape or the backdrop — never destroys work.
 */
export function ConfirmationDialog({ request }: { request: ConfirmationRequest }): ReactElement {
  const resolve = useUiStore((state) => state.resolveConfirmation);

  return (
    <Dialog
      title={request.title}
      onClose={() => resolve(false)}
      footer={
        <>
          <Button onClick={() => resolve(false)}>{request.cancelLabel ?? 'Cancel'}</Button>
          <Button
            appearance={request.danger === true ? 'danger' : 'primary'}
            onClick={() => resolve(true)}
          >
            {request.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    >
      <p>{request.message}</p>
    </Dialog>
  );
}
