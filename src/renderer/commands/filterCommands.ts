import type { ResolvedCommand } from './types';

/** Ranks commands by how directly the query matches title, description or keywords. */
export function filterCommands(
  commands: readonly ResolvedCommand[],
  query: string,
): ResolvedCommand[] {
  const visible = commands.filter((entry) => entry.definition.hiddenInPalette !== true);
  const needle = query.trim().toLowerCase();
  if (needle === '') return visible;

  const scored: Array<{ entry: ResolvedCommand; score: number }> = [];
  for (const entry of visible) {
    const title = entry.definition.title.toLowerCase();
    const description = entry.definition.description?.toLowerCase() ?? '';
    const keywords = (entry.definition.keywords ?? []).join(' ').toLowerCase();

    let score = -1;
    if (title.startsWith(needle)) score = 3;
    else if (title.includes(needle)) score = 2;
    else if (keywords.includes(needle)) score = 1;
    else if (description.includes(needle)) score = 0;

    if (score >= 0) scored.push({ entry, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.entry.definition.title.localeCompare(b.entry.definition.title),
    )
    .map((item) => item.entry);
}
