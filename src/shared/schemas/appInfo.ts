import { z } from 'zod';

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  isPackaged: z.boolean(),
  platform: z.string(),
  arch: z.string(),
  locale: z.string(),
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
    v8: z.string(),
  }),
  paths: z.object({
    userData: z.string(),
    logs: z.string(),
    temp: z.string(),
  }),
});

export type AppInfo = z.infer<typeof appInfoSchema>;
