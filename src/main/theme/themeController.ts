import { nativeTheme } from 'electron';
import type { ThemePreference } from '@shared/schemas/settings';
import type { ThemeState } from '@shared/schemas/theme';

export type ThemeListener = (state: ThemeState) => void;

/**
 * Owns the single source of truth for theme resolution. The renderer never
 * guesses from a media query: Windows tells Electron, Electron tells the
 * renderer. That keeps "Follow system" correct when the OS changes at runtime.
 */
export class ThemeController {
  private readonly listeners = new Set<ThemeListener>();

  constructor(private preference: ThemePreference) {
    nativeTheme.themeSource = preference;
    nativeTheme.on('updated', () => {
      this.emit();
    });
  }

  setPreference(preference: ThemePreference): void {
    if (this.preference === preference && nativeTheme.themeSource === preference) return;
    this.preference = preference;
    nativeTheme.themeSource = preference;
    this.emit();
  }

  getState(): ThemeState {
    return {
      preference: this.preference,
      resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    };
  }

  onChange(listener: ThemeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
