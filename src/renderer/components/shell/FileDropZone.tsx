import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { FilePlus2 } from 'lucide-react';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import styles from './FileDropZone.module.css';

/** Chromium no longer exposes File.path, so the preload resolves it for us. */
function pathsFromDrop(dataTransfer: DataTransfer): string[] {
  const paths: string[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    const filePath = window.paperforge.getPathForFile(file);
    if (filePath !== '') paths.push(filePath);
  }
  return paths;
}

/**
 * Accepts files dropped anywhere on the window. The drag counter keeps the
 * overlay steady while the pointer moves between child elements.
 */
export function FileDropZone({ children }: { children: ReactNode }): ReactElement {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const openPaths = useDocumentStore((state) => state.openPaths);
  const showToast = useUiStore((state) => state.showToast);

  const reset = useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  return (
    <div
      className={styles.zone}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        // Without this the browser opens the file instead of handing it over.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        reset();

        const paths = pathsFromDrop(event.dataTransfer);
        if (paths.length === 0) {
          showToast({
            title: 'Windows did not provide a location for that item.',
            description: 'Try opening it with Ctrl+O instead.',
            intent: 'warning',
          });
          return;
        }
        void openPaths(paths);
      }}
    >
      {children}
      {active && (
        <div className={styles.overlay} aria-hidden="true">
          <div className={styles.card}>
            <FilePlus2 className={styles.icon} strokeWidth={1.4} />
            <p className={styles.title}>Drop to open</p>
            <p className={styles.text}>PDF files open in this window.</p>
          </div>
        </div>
      )}
    </div>
  );
}
