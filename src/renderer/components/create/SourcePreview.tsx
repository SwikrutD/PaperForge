import { useEffect, useRef, useState, type ReactElement } from 'react';
import { FileText } from 'lucide-react';
import { sourceUrlFor } from '@shared/constants/app';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { renderEngine } from '../viewer/renderEngine';
import styles from './SourcePreview.module.css';

interface SourcePreviewProps {
  sourceId: string;
  /** Width in CSS pixels; the height follows the page's proportions. */
  width: number;
  /** Turned the way the pages will be in the new document. */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * The first page of a staged file.
 *
 * The bytes never leave the main process: the page is fetched over the
 * document protocol, like an open document, and drawn here. A file that
 * cannot be drawn shows a plain placeholder rather than an empty box.
 */
export function SourcePreview({ sourceId, width, rotation }: SourcePreviewProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<{ height: number; failed: boolean }>({
    height: Math.round(width * 1.4),
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    let document: LoadedPdfDocument | null = null;
    const controller = new AbortController();

    const draw = async (): Promise<void> => {
      document = await renderEngine.load({ url: sourceUrlFor(sourceId) });
      const page = document.pages[0];
      const canvas = canvasRef.current;
      if (cancelled || page === undefined || canvas === null) return;

      const turned = rotation === 90 || rotation === 270;
      const across = turned ? page.height : page.width;
      const down = turned ? page.width : page.height;
      setState({ height: Math.max(16, Math.round((width * down) / across)), failed: false });

      await document.renderPage({
        pageNumber: page.pageNumber,
        scale: width / across,
        rotation,
        canvas,
        devicePixelRatio: window.devicePixelRatio || 1,
        signal: controller.signal,
      });
    };

    void draw().catch(() => {
      if (!cancelled) setState((current) => ({ ...current, failed: true }));
    });

    return () => {
      cancelled = true;
      controller.abort();
      void document?.destroy().catch(() => undefined);
    };
  }, [sourceId, width, rotation]);

  return (
    <span
      className={styles.frame}
      style={{ width: `${String(width)}px`, height: `${String(state.height)}px` }}
    >
      {state.failed ? (
        <FileText className={styles.fallback} aria-hidden="true" strokeWidth={1.4} />
      ) : (
        <canvas className={styles.canvas} ref={canvasRef} />
      )}
    </span>
  );
}
