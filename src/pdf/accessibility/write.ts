import { PDFBool, PDFDict, PDFHexString, PDFName, type PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import { normalizePages } from '../mutate/operations';
import { infoDictionary } from '../metadata/write';
import { elementAt, readStructureTree } from './structure';

/**
 * The fixes the Accessibility Check can make.
 *
 * Each one changes a single, well-defined entry: a title, a viewer
 * preference, an element's alternate text, a field's description, a page's
 * tab order. None of them adds tags — PaperForge does not invent a structure a
 * document does not have.
 */
export function applyAccessibilityOperation(
  document: PDFDocument,
  operation: EditOperation,
): boolean {
  switch (operation.kind) {
    case 'setDocumentTitle': {
      const info = infoDictionary(document);
      const title = operation.title?.trim() ?? '';
      if (title === '') info.delete(PDFName.of('Title'));
      else info.set(PDFName.of('Title'), PDFHexString.fromText(title));
      return true;
    }

    case 'setDisplayDocTitle': {
      viewerPreferences(document).set(
        PDFName.of('DisplayDocTitle'),
        operation.display ? PDFBool.True : PDFBool.False,
      );
      return true;
    }

    case 'setAltText': {
      const tree = readStructureTree(document);
      const element = tree === null ? undefined : elementAt(tree, operation.path);
      if (
        element === undefined ||
        (element.type !== operation.expectedType && element.rawType !== operation.expectedType)
      ) {
        throw new AppError('internal/unexpected', {
          message: 'That element of the tags is no longer where it was. Run the check again.',
          details: `setAltText: ${operation.path} is ${element?.type ?? 'missing'}, expected ${operation.expectedType}`,
        });
      }
      const alt = operation.alt?.trim() ?? '';
      if (alt === '') element.dict.delete(PDFName.of('Alt'));
      else element.dict.set(PDFName.of('Alt'), PDFHexString.fromText(alt));
      return true;
    }

    case 'setFieldTooltips': {
      const form = document.getForm();
      for (const change of operation.fields) {
        const field = form.getFieldMaybe(change.name);
        if (field === undefined) {
          throw new AppError('internal/unexpected', {
            message: `There is no field called ${change.name} any more.`,
            details: `setFieldTooltips: ${change.name}`,
          });
        }
        const tooltip = change.tooltip?.trim() ?? '';
        if (tooltip === '') field.acroField.dict.delete(PDFName.of('TU'));
        else field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(tooltip));
      }
      return true;
    }

    case 'setTabOrder': {
      const pages = document.getPages();
      const targets =
        operation.pages === null
          ? pages.map((_, index) => index + 1)
          : normalizePages(operation.pages, pages.length);
      for (const number of targets) {
        pages[number - 1]?.node.set(PDFName.of('Tabs'), PDFName.of('S'));
      }
      return true;
    }

    default:
      return false;
  }
}

function viewerPreferences(document: PDFDocument): PDFDict {
  const existing = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('ViewerPreferences')),
    PDFDict,
  );
  if (existing !== undefined) return existing;
  const created = document.context.obj({});
  document.catalog.set(PDFName.of('ViewerPreferences'), created);
  return created;
}
