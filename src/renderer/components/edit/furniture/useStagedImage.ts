import { useState } from 'react';
import { AppError } from '@shared/errors/appError';
import type { StampImage } from '@shared/schemas/annotation';
import { invoke } from '../../../services/ipcClient';
import { useDocumentStore } from '../../../stores/documentStore';
import { useUiStore } from '../../../stores/uiStore';

export interface StagedImageField {
  /** Whether the dialog is working with words or with a picture. */
  kind: 'text' | 'image';
  setKind: (kind: 'text' | 'image') => void;
  staged: StampImage | null;
  choose: () => Promise<void>;
}

/**
 * An image chosen in a native dialog and kept by the main process.
 *
 * The file itself never crosses to the window: what comes back is a token and
 * the facts needed to describe the choice to the reader.
 */
export function useStagedImage(initial: 'text' | 'image' = 'text'): StagedImageField {
  const [kind, setKind] = useState<'text' | 'image'>(initial);
  const [staged, setStaged] = useState<StampImage | null>(null);

  const choose = async (): Promise<void> => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    try {
      const chosen = await invoke('images:choose', { sessionId });
      if (chosen !== null) setStaged(chosen);
    } catch (error) {
      const serialized = AppError.serialize(error);
      useUiStore.getState().showToast({
        title: serialized.message,
        description: serialized.details,
        intent: 'error',
      });
    }
  };

  return { kind, setKind, staged, choose };
}
