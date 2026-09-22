import { PdfjsRenderEngine } from '@pdf/render/pdfjsEngine';

/**
 * One engine per window. It owns the PDF.js worker, so sharing it keeps a
 * second document — or a search across documents — from starting another.
 */
export const renderEngine = new PdfjsRenderEngine();
