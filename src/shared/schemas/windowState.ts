import { z } from 'zod';

/** Live window state, as opposed to the geometry persisted in settings. */
export const windowRuntimeStateSchema = z.object({
  fullScreen: z.boolean(),
  maximized: z.boolean(),
  focused: z.boolean(),
});

export type WindowRuntimeState = z.infer<typeof windowRuntimeStateSchema>;
