import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { PdfDocumentReactContext, type PdfDocumentContextValue } from './pdfDocumentContextValue';
import { usePdfDocument } from './usePdfDocument';

/**
 * Loads the active document once and shares it with everything that needs it:
 * the page column, the thumbnails, the outline, the layers and search. Panels
 * live outside the workspace in the shell, so this sits above both.
 */
export function PdfDocumentProvider({
  tab,
  children,
}: {
  tab: DocumentTab | null;
  children: ReactNode;
}): ReactElement {
  const state = usePdfDocument(tab?.session.id ?? null, tab?.edit.revision ?? 0);
  const [layersVersion, setLayersVersion] = useState(0);
  const setPageCount = useDocumentStore((store) => store.setPageCount);

  // The page count comes from the render engine, and the commands that change
  // the document need it: deleting the last page of a document is refused.
  const sessionId = tab?.session.id ?? null;
  const pageCount = state.document?.pages.length ?? 0;
  useEffect(() => {
    if (sessionId !== null && pageCount > 0) setPageCount(sessionId, pageCount);
  }, [sessionId, pageCount, setPageCount]);

  const setLayerVisible = useCallback(
    (id: string, visible: boolean) => {
      state.document?.setLayerVisible(id, visible);
      setLayersVersion((version) => version + 1);
    },
    [state.document],
  );

  const value = useMemo<PdfDocumentContextValue>(
    () => ({ ...state, tab, layersVersion, setLayerVisible }),
    [state, tab, layersVersion, setLayerVisible],
  );

  return (
    <PdfDocumentReactContext.Provider value={value}>{children}</PdfDocumentReactContext.Provider>
  );
}
