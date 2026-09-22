import path from 'node:path';
import {
  applySettingsPatch,
  parseStoredSettings,
  type Settings,
  type SettingsPatch,
} from '@shared/schemas/settings';
import { SETTINGS_FILE_NAME } from '@shared/constants/app';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import { readJsonFile } from '../filesystem/readJsonFile';
import type { Logger } from '../logging/logger';

export type SettingsListener = (settings: Settings) => void;

/**
 * Per-user settings persisted as JSON in the app's data directory.
 *
 * Reads are validated with Zod; anything unreadable is repaired to defaults
 * rather than crashing the app. Writes go through the atomic write helper so a
 * crash mid-save cannot corrupt the file.
 */
export class SettingsStore {
  private readonly filePath: string;
  private readonly listeners = new Set<SettingsListener>();
  private settings: Settings | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    directory: string,
    private readonly logger: Logger,
  ) {
    this.filePath = path.join(directory, SETTINGS_FILE_NAME);
  }

  async load(): Promise<Settings> {
    let raw: unknown;
    try {
      raw = await readJsonFile(this.filePath);
    } catch (error) {
      this.logger.warn('Settings file unreadable; restoring defaults.', error);
      raw = undefined;
    }

    const { settings, repaired } = parseStoredSettings(raw);
    this.settings = settings;
    if (repaired && raw !== undefined) {
      this.logger.warn('Settings file contained invalid values; repaired with defaults.');
    }
    return settings;
  }

  get(): Settings {
    if (this.settings === undefined) {
      throw new Error('SettingsStore.load() must be awaited before reading settings.');
    }
    return this.settings;
  }

  async patch(patch: SettingsPatch): Promise<Settings> {
    const next = applySettingsPatch(this.get(), patch);
    this.settings = next;
    for (const listener of this.listeners) listener(next);
    await this.persist(next);
    return next;
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Serializes writes so rapid updates cannot interleave on disk. */
  private persist(settings: Settings): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.filePath, `${JSON.stringify(settings, null, 2)}\n`))
      .catch((error: unknown) => {
        this.logger.error('Failed to persist settings.', error);
      });
    return this.writeChain;
  }
}
