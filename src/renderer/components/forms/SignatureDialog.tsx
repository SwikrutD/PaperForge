import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { Eraser, Trash2 } from 'lucide-react';
import type { SignatureKind } from '@shared/schemas/signature';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Dialog } from '../overlays/Dialog';
import { useSignatureStore } from '../../stores/signatureStore';
import { useUiStore } from '../../stores/uiStore';
import { cx } from '../../utils/classNames';
import {
  drawnSignature,
  importedSignature,
  typedSignature,
  SIGNATURE_STYLES,
  type SignatureStyleId,
} from './signatureArt';
import styles from '../overlays/dialogForm.module.css';
import own from './signature.module.css';

type Way = 'draw' | 'type' | 'image';

/**
 * Making a simple signature: drawn with the pointer, typed, or brought in as
 * a picture.
 *
 * Whichever way it is made, the result is one picture placed on the page. It
 * is a visual mark — PaperForge does not sign with a certificate — and the
 * dialog says so rather than leaving the impression that it might.
 */
export function SignatureDialog({ kind }: { kind: SignatureKind }): ReactElement {
  const close = useSignatureStore((store) => store.closeDialog);
  const saved = useSignatureStore((store) => store.saved);
  const busy = useSignatureStore((store) => store.busy);

  const [way, setWay] = useState<Way>('draw');
  const [text, setText] = useState('');
  const [style, setStyle] = useState<SignatureStyleId>(SIGNATURE_STYLES[0].id);
  const [remember, setRemember] = useState(false);
  const [imported, setImported] = useState<{ dataUrl: string; name: string } | null>(null);
  const [drawn, setDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const noun = kind === 'initials' ? 'initials' : 'signature';

  // The drawing surface is sized to its box once, in device pixels, so the
  // ink is smooth on a high-DPI screen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || way !== 'draw') return;

    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));

    const context = canvas.getContext('2d');
    if (context === null) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111111';
  }, [way]);

  const pointOf = (event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const startStroke = (event: PointerEvent<HTMLCanvasElement>): void => {
    const context = canvasRef.current?.getContext('2d');
    if (context == null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const point = pointOf(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const continueStroke = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (context == null) return;
    const point = pointOf(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setDrawn(true);
  };

  const endStroke = (): void => {
    drawing.current = false;
  };

  const clearDrawing = (): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas == null || context == null) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setDrawn(false);
  };

  const chooseImage = async (): Promise<void> => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
    if (file === null) return;

    try {
      setImported({ dataUrl: await importedSignature(file), name: file.name });
    } catch (error) {
      useUiStore.getState().showToast({
        title: 'That picture could not be used as a signature.',
        description: error instanceof Error ? error.message : undefined,
        intent: 'error',
      });
    }
  };

  const ready =
    (way === 'draw' && drawn) ||
    (way === 'type' && text.trim() !== '') ||
    (way === 'image' && imported !== null);

  const apply = (): void => {
    const made =
      way === 'draw'
        ? drawnSignature(canvasRef.current)
        : way === 'type'
          ? typedSignature(text.trim(), style)
          : imported === null
            ? null
            : { dataUrl: imported.dataUrl, width: 0, height: 0 };
    if (made === null) return;

    const finish = (dataUrl: string, width: number, height: number): void => {
      void useSignatureStore.getState().place({
        kind,
        name: way === 'type' ? text.trim() : (imported?.name ?? `Drawn ${noun}`),
        dataUrl,
        width,
        height,
        remember,
      });
    };

    if (made.width > 0) {
      finish(made.dataUrl, made.width, made.height);
      return;
    }

    // An imported picture is measured by loading it, which the browser does
    // for us and PaperForge does not have to parse.
    const image = new Image();
    image.onload = () => finish(made.dataUrl, image.naturalWidth, image.naturalHeight);
    image.src = made.dataUrl;
  };

  return (
    <Dialog
      title={kind === 'initials' ? 'Initials' : 'Signature'}
      description={`Draw, type or bring in a picture of your ${noun}. It is a mark on the page, not a certificate-based signature.`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button appearance="primary" onClick={apply} disabled={!ready || busy}>
            Place it
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={own.ways} role="tablist" aria-label="How to make it">
          {(['draw', 'type', 'image'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={way === entry}
              className={cx(own.way, way === entry && own.wayActive)}
              onClick={() => setWay(entry)}
            >
              {entry === 'draw' ? 'Draw' : entry === 'type' ? 'Type' : 'Picture'}
            </button>
          ))}
        </div>

        {way === 'draw' && (
          <div className={own.drawBox}>
            <canvas
              ref={canvasRef}
              className={own.canvas}
              aria-label={`Draw your ${noun} here`}
              onPointerDown={startStroke}
              onPointerMove={continueStroke}
              onPointerUp={endStroke}
              onPointerLeave={endStroke}
            />
            <IconButton icon={Eraser} label="Clear" tooltip="Start again" onClick={clearDrawing} />
          </div>
        )}

        {way === 'type' && (
          <>
            <div className={styles.row}>
              <label className={styles.label} htmlFor="signature-text">
                {kind === 'initials' ? 'Initials' : 'Name'}
              </label>
              <input
                id="signature-text"
                type="text"
                className={`${styles.input} ${styles.grow}`}
                value={text}
                maxLength={60}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            <div className={own.styles} role="radiogroup" aria-label="Style">
              {SIGNATURE_STYLES.map((entry) => (
                <label key={entry.id} className={cx(own.style, style === entry.id && own.styleOn)}>
                  <input
                    type="radio"
                    name="signature-style"
                    checked={style === entry.id}
                    onChange={() => setStyle(entry.id)}
                  />
                  <span style={{ fontFamily: entry.font }} className={own.sample}>
                    {text.trim() === '' ? 'Your name' : text}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {way === 'image' && (
          <div className={own.drawBox}>
            {imported === null ? (
              <p className={styles.hint}>
                A PNG or JPEG. A photograph of a signature on white paper works best: PaperForge
                clears the paper away and keeps the ink.
              </p>
            ) : (
              <img
                src={imported.dataUrl}
                alt="The signature you brought in"
                className={own.preview}
              />
            )}
            <Button onClick={() => void chooseImage()}>Choose picture</Button>
          </div>
        )}

        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span className={styles.choiceText}>
            Keep this {noun} on this computer
            <span className={styles.hint}>
              Kept locally, never sent anywhere, and cleared from Settings → Privacy.
            </span>
          </span>
        </label>

        {saved.length > 0 && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Kept on this computer</legend>
            <ul className={own.saved}>
              {saved
                .filter((entry) => entry.kind === kind)
                .map((entry) => (
                  <li key={entry.id} className={own.savedItem}>
                    <button
                      type="button"
                      className={own.savedButton}
                      onClick={() => void useSignatureStore.getState().placeSaved(entry.id)}
                    >
                      <img src={entry.dataUrl} alt={entry.name} className={own.savedImage} />
                    </button>
                    <IconButton
                      icon={Trash2}
                      label={`Forget ${entry.name}`}
                      size="small"
                      onClick={() => void useSignatureStore.getState().forget(entry.id)}
                    />
                  </li>
                ))}
            </ul>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
