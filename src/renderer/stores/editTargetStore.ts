import { create } from 'zustand';
import { useImageEditStore } from './imageEditStore';
import { useLinkEditStore } from './linkEditStore';
import { useTextEditStore } from './textEditStore';

/** What the editor is pointing at: the words, the pictures, or the links. */
export type EditTarget = 'text' | 'images' | 'links';

interface EditTargetStore {
  target: EditTarget;
  setTarget: (target: EditTarget) => void;
}

/**
 * Which kind of object the editor is working on.
 *
 * Only one layer takes the pointer at a time, so a click on a caption printed
 * over a photograph is never a guess about which of the two was meant.
 * Changing what is being pointed at puts down whatever was being held.
 */
export const useEditTargetStore = create<EditTargetStore>((set) => ({
  target: 'text',

  setTarget: (target) => {
    set({ target });
    useTextEditStore.getState().setPlacing(false);
    useImageEditStore.getState().reset();
    useLinkEditStore.getState().reset();
  },
}));
