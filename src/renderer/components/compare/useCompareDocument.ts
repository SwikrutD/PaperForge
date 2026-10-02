import { useEffect, useState } from 'react';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { compareDocument } from '../../services/compareDocuments';
import { useCompareStore, type CompareSide } from '../../stores/compareStore';

/**
 * The document on one side of the comparison that was run, once it has
 * loaded. A comparison not yet run has nothing to show.
 */
export function useCompareDocument(side: CompareSide): LoadedPdfDocument | null {
  const comparedFor = useCompareStore((state) => state.comparedFor);
  const sessionId = comparedFor === null ? null : comparedFor[side];
  const revision =
    comparedFor === null
      ? 0
      : side === 'original'
        ? comparedFor.originalRevision
        : comparedFor.revisedRevision;
  const key = sessionId === null ? null : `${sessionId}:${String(revision)}`;
  const [loaded, setLoaded] = useState<{ key: string; document: LoadedPdfDocument } | null>(null);

  useEffect(() => {
    if (sessionId === null || key === null) return;
    let current = true;
    compareDocument(side, sessionId, revision)
      .then((document) => {
        if (current) setLoaded({ key, document });
      })
      .catch(() => {
        // The comparison itself reports a document it could not open.
      });
    return () => {
      current = false;
    };
  }, [side, sessionId, revision, key]);

  return loaded !== null && loaded.key === key ? loaded.document : null;
}
