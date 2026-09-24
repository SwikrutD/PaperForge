import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { StampImage } from '@shared/schemas/annotation';
import type { SavedSignature, SignatureKind } from '@shared/schemas/signature';
import { invoke } from '../services/ipcClient';
import { useAnnotationStore } from './annotationStore';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

export interface SignatureStore {
  /** Which dialog is open, if any. */
  open: SignatureKind | null;
  /** The signatures this computer has been asked to keep. */
  saved: SavedSignature[];
  /** The mark waiting to be put on a page. */
  staged: StampImage | null;
  busy: boolean;

  openDialog: (kind: SignatureKind) => void;
  closeDialog: () => void;
  loadSaved: () => Promise<void>;
  /** Stages a picture of a mark, and readies the page to receive it. */
  place: (input: {
    kind: SignatureKind;
    name: string;
    /** The mark as a PNG data URL, drawn by the window. */
    dataUrl: string;
    width: number;
    height: number;
    remember: boolean;
  }) => Promise<void>;
  /** Puts a saved signature on a page again. */
  placeSaved: (id: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
  /** Forgets every saved signature, from Settings → Privacy. */
  clearSaved: () => Promise<void>;
  /** Called once the mark has been put down. */
  clearStaged: () => void;
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

/** The base64 payload of a data URL, which is what crosses to the main process. */
function payloadOf(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Simple signatures: a mark the reader draws, types or brings in as a
 * picture, put on the page as a stamp.
 *
 * It is a visual mark and nothing more. PaperForge does not sign with a
 * certificate, does not validate one, and says so wherever a reader might
 * reasonably wonder.
 */
export const useSignatureStore = create<SignatureStore>((set, get) => ({
  open: null,
  saved: [],
  staged: null,
  busy: false,

  openDialog: (kind) => {
    set({ open: kind });
    void get().loadSaved();
  },
  closeDialog: () => set({ open: null }),

  loadSaved: async () => {
    try {
      set({ saved: await invoke('signatures:list') });
    } catch (error) {
      report(error);
    }
  },

  place: async (input) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    set({ busy: true });
    try {
      const staged = await invoke('signatures:stage', {
        sessionId,
        kind: input.kind,
        name: input.name,
        data: payloadOf(input.dataUrl),
        width: input.width,
        height: input.height,
        remember: input.remember,
      });
      set({ staged, open: null });
      // The next click on a page puts it down.
      useAnnotationStore.getState().setTool('imageStamp');
      if (input.remember) void get().loadSaved();
    } catch (error) {
      report(error);
    } finally {
      set({ busy: false });
    }
  },

  placeSaved: async (id) => {
    const entry = get().saved.find((candidate) => candidate.id === id);
    if (entry === undefined) return;

    await get().place({
      kind: entry.kind,
      name: entry.name,
      dataUrl: entry.dataUrl,
      width: entry.width,
      height: entry.height,
      remember: false,
    });
  },

  forget: async (id) => {
    try {
      set({ saved: await invoke('signatures:remove', { id }) });
    } catch (error) {
      report(error);
    }
  },

  clearSaved: async () => {
    try {
      await invoke('signatures:clear');
      set({ saved: [] });
    } catch (error) {
      report(error);
    }
  },

  clearStaged: () => {
    // Only when a mark was waiting: this is called whenever anything is put on
    // a page, and picking the select tool would throw away a text box that has
    // just been drawn and not yet typed into.
    if (get().staged === null) return;
    set({ staged: null });
    useAnnotationStore.getState().setTool('select');
  },
}));
