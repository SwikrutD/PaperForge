import type { ReactElement } from 'react';

interface LogoMarkProps {
  size?: number;
  /** Decorative by default; pass a title when the mark is the only label. */
  title?: string;
}

/**
 * PaperForge mark: a sheet with a folded corner over a blue tile. Original
 * geometry, mirrored by scripts/generate-icon.mjs for the Windows app icon.
 */
export function LogoMark({ size = 24, title }: LogoMarkProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title === undefined ? 'presentation' : 'img'}
      aria-hidden={title === undefined}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id="pf-logo-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2886de" />
          <stop offset="1" stopColor="#0c4a80" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="7" fill="url(#pf-logo-tile)" />
      <path
        d="M10.4 7.6h7.6l4.9 4.9v11.5a1.2 1.2 0 0 1-1.2 1.2H10.4a1.2 1.2 0 0 1-1.2-1.2V8.8a1.2 1.2 0 0 1 1.2-1.2z"
        fill="#ffffff"
      />
      <path d="M18 7.6l4.9 4.9H18z" fill="#a9c9ec" />
      <rect x="11.9" y="16.4" width="8.2" height="1.5" rx="0.75" fill="#0f6cbd" />
      <rect x="11.9" y="19.4" width="5.6" height="1.5" rx="0.75" fill="#7aa9d8" />
    </svg>
  );
}
