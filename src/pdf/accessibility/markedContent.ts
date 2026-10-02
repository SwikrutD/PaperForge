import type { ContentOperation } from '../content/parser';
import { nameOf } from '../content/values';

/**
 * Marked content: the `BDC … EMC` brackets a tagged page draws its content
 * in. A bracket with an `/MCID` ties what it draws to an element of the tag
 * tree; one tagged `/Artifact` says what it draws is decoration that a reader
 * should skip — a running header, a page number, a rule.
 */

export interface MarkedState {
  /** The innermost marked-content identifier in force, or null. */
  mcid: number | null;
  /** True inside an `/Artifact` bracket. */
  artifact: boolean;
}

const UNMARKED: MarkedState = { mcid: null, artifact: false };

/**
 * What every operation of a stream is inside.
 *
 * `properties` resolves a `/Name` operand to the `/MCID` of the property list
 * the page's resources keep under that name, for documents that write their
 * brackets that way rather than inline.
 */
export function markedStates(
  operations: readonly ContentOperation[],
  properties: (name: string) => number | null = () => null,
): MarkedState[] {
  const states: MarkedState[] = [];
  const stack: MarkedState[] = [];
  let current = UNMARKED;

  for (const operation of operations) {
    const { operator, operands } = operation;

    if (operator === 'BMC' || operator === 'BDC') {
      const tag = nameOf(operands[0]);
      const mcid = operator === 'BDC' ? mcidOf(operands[1], properties) : null;
      stack.push(current);
      current = {
        mcid: mcid ?? current.mcid,
        artifact: current.artifact || tag === 'Artifact',
      };
      // The bracket itself belongs to what it opens.
      states.push(current);
      continue;
    }

    if (operator === 'EMC') {
      states.push(current);
      current = stack.pop() ?? UNMARKED;
      continue;
    }

    states.push(current);
  }

  return states;
}

function mcidOf(
  value: ContentOperation['operands'][number] | undefined,
  properties: (name: string) => number | null,
): number | null {
  if (value === undefined) return null;
  if (value.kind === 'dict') {
    const mcid = value.entries.get('MCID');
    return mcid?.kind === 'number' && Number.isInteger(mcid.value) ? mcid.value : null;
  }
  if (value.kind === 'name') return properties(value.value);
  return null;
}
