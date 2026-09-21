/// <reference types="vite/client" />
import type { PaperForgeBridge } from '@shared/types/bridge';

declare global {
  interface Window {
    readonly paperforge: PaperForgeBridge;
  }
}
