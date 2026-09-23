import type { ReactElement } from 'react';
import type { TextFamily } from '@shared/schemas/text';
import { useTextEditStore } from '../../stores/textEditStore';
import styles from './EditProperties.module.css';

const FAMILIES: Array<{ id: TextFamily; label: string }> = [
  { id: 'helvetica', label: 'Helvetica' },
  { id: 'times', label: 'Times' },
  { id: 'courier', label: 'Courier' },
];

/**
 * What text PaperForge draws itself looks like: new text, and text it has to
 * replace because the original font cannot write it.
 *
 * These are the fonts every PDF reader already has, so nothing is embedded and
 * no font is redistributed. Text drawn from the document keeps its own font;
 * this is only for what PaperForge adds.
 */
export function TextStyleControls(): ReactElement {
  const style = useTextEditStore((store) => store.style);
  const setStyle = useTextEditStore((store) => store.setStyle);

  const color = `#${[style.color.r, style.color.g, style.color.b]
    .map((part) =>
      Math.round(part * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

  return (
    <section className={styles.group}>
      <h3 className={styles.title}>Text PaperForge adds</h3>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="text-family">
          Font
        </label>
        <select
          id="text-family"
          className={styles.select}
          value={style.family}
          onChange={(event) => setStyle({ family: event.target.value as TextFamily })}
        >
          {FAMILIES.map((family) => (
            <option key={family.id} value={family.id}>
              {family.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Style</span>
        <span className={styles.toggles}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={style.bold}
              onChange={(event) => setStyle({ bold: event.target.checked })}
            />
            Bold
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={style.italic}
              onChange={(event) => setStyle({ italic: event.target.checked })}
            />
            Italic
          </label>
        </span>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="text-size">
          Size
        </label>
        <input
          id="text-size"
          type="number"
          className={styles.number}
          min={1}
          max={400}
          value={style.size}
          onChange={(event) =>
            setStyle({ size: Math.max(1, Math.min(400, Number(event.target.value) || 12)) })
          }
        />
        <span className={styles.suffix}>pt</span>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="text-color">
          Colour
        </label>
        <input
          id="text-color"
          type="color"
          className={styles.picker}
          value={color}
          onChange={(event) => setStyle({ color: fromHex(event.target.value) })}
        />
      </div>
    </section>
  );
}

function fromHex(value: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (match === null) return { r: 0, g: 0, b: 0 };
  const number = Number.parseInt(match[1] as string, 16);
  return {
    r: ((number >> 16) & 0xff) / 255,
    g: ((number >> 8) & 0xff) / 255,
    b: (number & 0xff) / 255,
  };
}
