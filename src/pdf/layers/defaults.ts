import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';

/**
 * Which layers a document shows when it is opened.
 *
 * That is the default configuration of its optional content: `/ON` and
 * `/OFF` in `/OCProperties /D`. PaperForge writes both lists in full, so the
 * result does not depend on a `/BaseState` another program might read
 * differently, and changes nothing else about the layers.
 */
export function applyLayerOperation(document: PDFDocument, operation: EditOperation): boolean {
  if (operation.kind !== 'setLayerDefaults') return false;

  const properties = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('OCProperties')),
    PDFDict,
  );
  const groups = document.context.lookupMaybe(properties?.get(PDFName.of('OCGs')), PDFArray);
  if (properties === undefined || groups === undefined) {
    throw new AppError('internal/unexpected', {
      message: 'This document has no layers.',
      details: 'setLayerDefaults: no /OCProperties /OCGs',
    });
  }

  const known = new Set<string>();
  for (let index = 0; index < groups.size(); index += 1) {
    const entry = groups.get(index);
    if (entry instanceof PDFRef) known.add(viewerId(entry));
  }

  const on = PDFArray.withContext(document.context);
  const off = PDFArray.withContext(document.context);
  for (const layer of operation.layers) {
    if (!known.has(layer.id)) {
      throw new AppError('internal/unexpected', {
        message: 'That layer is no longer in this document.',
        details: `setLayerDefaults: ${layer.id}`,
      });
    }
    (layer.visible ? on : off).push(refOf(layer.id));
  }

  let defaults = document.context.lookupMaybe(properties.get(PDFName.of('D')), PDFDict);
  if (defaults === undefined) {
    defaults = document.context.obj({});
    properties.set(PDFName.of('D'), defaults);
  }
  defaults.delete(PDFName.of('BaseState'));
  defaults.set(PDFName.of('ON'), on);
  defaults.set(PDFName.of('OFF'), off);
  return true;
}

/** How the viewer names a layer: "12R", or "12R3" for a later generation. */
function viewerId(ref: PDFRef): string {
  return ref.generationNumber === 0
    ? `${String(ref.objectNumber)}R`
    : `${String(ref.objectNumber)}R${String(ref.generationNumber)}`;
}

function refOf(id: string): PDFRef {
  const [objectNumber = '0', generation = ''] = id.split('R');
  return PDFRef.of(
    Number.parseInt(objectNumber, 10),
    generation === '' ? 0 : Number.parseInt(generation, 10),
  );
}
