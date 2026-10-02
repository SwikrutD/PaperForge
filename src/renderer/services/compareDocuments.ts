import { documentUrlForSession } from '@shared/constants/app';
import { AppError } from '@shared/errors/appError';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { renderEngine } from '../components/viewer/renderEngine';

/**
 * The two documents being compared, loaded once each and shared by the
 * comparison and the panes that show it. They are separate from the viewer's
 * own document, so comparing never disturbs what the reader has open.
 */

interface Loaded {
  key: string;
  promise: Promise<LoadedPdfDocument>;
}

const loaded = new Map<'original' | 'revised', Loaded>();

export function compareDocument(
  side: 'original' | 'revised',
  sessionId: string,
  revision: number,
): Promise<LoadedPdfDocument> {
  const key = `${sessionId}:${String(revision)}`;
  const existing = loaded.get(side);
  if (existing?.key === key) return existing.promise;
  if (existing !== undefined)
    void existing.promise.then((document) => document.destroy()).catch(() => undefined);

  const promise = renderEngine
    .load({
      url: documentUrlForSession(sessionId, revision),
      // The reader typed the password into the viewer, which keeps it to
      // itself; asking again here would be a second prompt for one document.
      requestPassword: () => Promise.resolve(null),
    })
    .catch((error: unknown) => {
      loaded.delete(side);
      const serialized = AppError.serialize(error);
      throw new AppError(serialized.code, {
        message:
          serialized.code === 'pdf/encrypted' || serialized.code === 'op/cancelled'
            ? 'A document that needs a password to open cannot be compared yet.'
            : serialized.message,
        details: serialized.details,
        cause: error,
      });
    });
  loaded.set(side, { key, promise });
  return promise;
}

/** Lets go of both documents, when the comparison closes. */
export async function releaseCompareDocuments(): Promise<void> {
  const entries = [...loaded.values()];
  loaded.clear();
  for (const entry of entries) {
    await entry.promise.then((document) => document.destroy()).catch(() => undefined);
  }
}
