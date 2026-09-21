import { z } from 'zod';
import { resolvedThemeSchema, themePreferenceSchema } from './settings';

export const themeStateSchema = z.object({
  /** What the user asked for. */
  preference: themePreferenceSchema,
  /** What Windows resolved that to right now. */
  resolved: resolvedThemeSchema,
});

export type ThemeState = z.infer<typeof themeStateSchema>;
