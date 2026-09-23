import type { PageSetup } from '@shared/schemas/create';

/**
 * Turning a local file into PDF pages.
 *
 * Every way into PaperForge goes through this interface: images, text and web
 * pages today, and local Office conversion when it lands (CLAUDE.md section
 * 2.5). A provider states which extensions it handles and whether it can run
 * at all, so a file type whose local component is missing can be refused with
 * a reason rather than silently producing nothing.
 */

export interface SourceInput {
  bytes: Uint8Array;
  fileName: string;
  /** Lower-case extension without the dot, taken from the file's name. */
  extension: string;
  /**
   * Where the file is, for a provider that must hand the path to something
   * else — Chromium's own printing, or a local converter.
   */
  path: string;
}

export interface ConversionProvider {
  readonly id: string;
  /** What this provider converts, in words for a file dialog. */
  readonly label: string;
  readonly extensions: readonly string[];
  /**
   * Null when the provider can run; otherwise why it cannot, in words a reader
   * can act on. Nothing is ever downloaded to make it available.
   */
  availability(): Promise<string | null>;
  toPdf(input: SourceInput, setup: PageSetup): Promise<Uint8Array>;
}

/** The providers a running PaperForge has. */
export class ConversionRegistry {
  private readonly providers: ConversionProvider[] = [];

  add(provider: ConversionProvider): void {
    this.providers.push(provider);
  }

  /** The provider for a file, by its extension. */
  forExtension(extension: string): ConversionProvider | undefined {
    const wanted = extension.replace(/^\./, '').toLowerCase();
    return this.providers.find((provider) => provider.extensions.includes(wanted));
  }

  list(): readonly ConversionProvider[] {
    return this.providers;
  }

  /** Dialog filters covering everything that can be made into a PDF. */
  fileFilters(): Array<{ name: string; extensions: string[] }> {
    const everything = [...new Set(this.providers.flatMap((provider) => provider.extensions))];
    return [
      { name: 'All supported files', extensions: everything },
      ...this.providers.map((provider) => ({
        name: provider.label,
        extensions: [...provider.extensions],
      })),
    ];
  }
}
