import { createContext, useContext } from 'react';
import type { DocumentTab } from '../../stores/documentStore';
import type { PdfDocumentState } from './usePdfDocument';

export interface PdfDocumentContextValue extends PdfDocumentState {
  /** The tab this document belongs to, or null when none is open. */
  tab: DocumentTab | null;
  /**
   * Bumped when layer visibility changes, so mounted pages redraw. Layer state
   * lives on the loaded document itself, which React cannot see into.
   */
  layersVersion: number;
  setLayerVisible: (id: string, visible: boolean) => void;
}

const EMPTY: PdfDocumentState = {
  status: 'loading',
  document: null,
  revision: 0,
  error: null,
  passwordRetry: false,
  submitPassword: () => undefined,
  cancelPassword: () => undefined,
  reload: () => undefined,
};

export const PdfDocumentReactContext = createContext<PdfDocumentContextValue>({
  ...EMPTY,
  tab: null,
  layersVersion: 0,
  setLayerVisible: () => undefined,
});

export function usePdfDocumentContext(): PdfDocumentContextValue {
  return useContext(PdfDocumentReactContext);
}
