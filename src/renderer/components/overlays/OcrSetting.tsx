import { useEffect, type ReactElement } from 'react';
import { OCR_DPI_CHOICES } from '@shared/schemas/ocr';
import { Button } from '../controls/Button';
import { useOcrStore } from '../../stores/ocrStore';
import styles from './SettingsDialog.module.css';

/**
 * Where Tesseract is, which languages it has, and what PaperForge will choose
 * by default when it reads a scan.
 *
 * Language packs are folders of files on this computer. PaperForge lists what
 * is there and will point at another folder; it downloads nothing, here or
 * anywhere else.
 */
export function OcrSetting(): ReactElement {
  const status = useOcrStore((store) => store.status);
  const options = useOcrStore((store) => store.options);

  useEffect(() => {
    void useOcrStore.getState().refreshStatus();
  }, []);

  const description =
    status === null
      ? 'Looking for Tesseract…'
      : status.available
        ? `${status.version ?? 'Installed'} · ${status.path ?? ''}`
        : (status.problem ?? 'Tesseract was not found.');

  const languages = (status?.languages ?? []).filter((language) => language !== 'osd');

  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowLabel}>Tesseract</p>
          <p className={styles.rowDescription}>{description}</p>
        </div>
        <div className={styles.rowControl}>
          <Button onClick={() => void useOcrStore.getState().locate()}>Locate…</Button>
          {status !== null && status.path !== null && (
            <Button onClick={() => void useOcrStore.getState().locate(true)}>Use automatic</Button>
          )}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowLabel}>Language data</p>
          <p className={styles.rowDescription}>
            {languages.length === 0
              ? 'No language packs were found. A pack is a .traineddata file in a tessdata folder.'
              : `${String(languages.length)} installed: ${languages.join(', ')}${
                  status?.tessdataPath === null || status?.tessdataPath === undefined
                    ? ''
                    : ` · ${status.tessdataPath}`
                }`}
          </p>
        </div>
        <div className={styles.rowControl}>
          <Button onClick={() => void useOcrStore.getState().locateLanguages()}>Choose…</Button>
          {status?.tessdataPath !== null && status?.tessdataPath !== undefined && (
            <Button onClick={() => void useOcrStore.getState().locateLanguages(true)}>
              Use automatic
            </Button>
          )}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowLabel}>Default language</p>
          <p className={styles.rowDescription}>What Recognize Text starts with.</p>
        </div>
        <div className={styles.rowControl}>
          <select
            className={styles.select}
            aria-label="Default language"
            value={options.languages[0] ?? ''}
            disabled={languages.length === 0}
            onChange={(event) =>
              useOcrStore.getState().setOptions({ languages: [event.target.value] })
            }
          >
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowLabel}>Default resolution</p>
          <p className={styles.rowDescription}>
            How finely a page is rendered before it is read. 300 dots an inch is what a scanner
            produces and what Tesseract expects.
          </p>
        </div>
        <div className={styles.rowControl}>
          <select
            className={styles.select}
            aria-label="Default resolution"
            value={options.dpi}
            onChange={(event) =>
              useOcrStore.getState().setOptions({ dpi: Number(event.target.value) })
            }
          >
            {OCR_DPI_CHOICES.map((dpi) => (
              <option key={dpi} value={dpi}>
                {`${String(dpi)} dpi`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
