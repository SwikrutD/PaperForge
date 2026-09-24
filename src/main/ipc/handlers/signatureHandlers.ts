import type { StampImage } from '@shared/schemas/annotation';
import { measureImage } from '@shared/utils/imageHeader';
import { AppError } from '@shared/errors/appError';
import type { SignatureLibrary } from '../../services/signatures/signatureLibrary';
import { pngFromDataUrl } from '../../services/signatures/signatureLibrary';
import type { StagedAssets } from '../../services/documents/stagedAssets';
import type { RegisterInvoke } from '../registry';

export interface SignatureHandlerDeps {
  signatures: SignatureLibrary;
  stagedAssets: StagedAssets;
}

/**
 * Simple signatures: drawn, typed or brought in as a picture.
 *
 * The window draws the mark and sends the picture here; this process stages
 * it for placing, and keeps it for next time only when the reader ticked
 * Remember. A signature is a visual mark and nothing more — PaperForge does
 * not sign with a certificate and does not say it does.
 */
export function registerSignatureHandlers(
  registerInvoke: RegisterInvoke,
  deps: SignatureHandlerDeps,
): void {
  registerInvoke('signatures:list', () => deps.signatures.list());

  registerInvoke('signatures:stage', async (request) => {
    const bytes = pngFromDataUrl(`data:image/png;base64,${request.data}`);
    const measured = measureImage(bytes);
    if (measured === null) {
      throw new AppError('internal/unexpected', {
        message: 'That signature could not be read.',
        details: 'the picture is not a PNG',
      });
    }

    const staged: StampImage = deps.stagedAssets.stageImageBytes(
      request.sessionId,
      bytes,
      request.name,
    );

    if (request.remember) {
      await deps.signatures.save({
        kind: request.kind,
        name: request.name,
        width: measured.width,
        height: measured.height,
        dataUrl: `data:image/png;base64,${request.data}`,
      });
    }

    return staged;
  });

  registerInvoke('signatures:remove', async ({ id }) => {
    await deps.signatures.remove(id);
    return deps.signatures.list();
  });

  registerInvoke('signatures:clear', async () => {
    await deps.signatures.clear();
    return null;
  });
}
