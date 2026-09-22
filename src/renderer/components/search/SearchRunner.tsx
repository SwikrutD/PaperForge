import type { ReactElement } from 'react';
import { useSearchScan } from './useSearchScan';

/**
 * Drives the search for the window. It renders nothing: results go to the
 * search store, where the find bar, the results list and the page highlights
 * read them.
 */
export function SearchRunner(): ReactElement | null {
  useSearchScan();
  return null;
}
