import { COPY, PRIORITY_SYMBOLS } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';

/** Screen-reader actions for hold-to-pick, in the order a reader hears them. */
export const QUICK_PICK_ACTIONS: readonly { name: string; label: string }[] = [
  { name: 'must', label: PRIORITY_SYMBOLS.must.label },
  { name: 'want-to-see', label: PRIORITY_SYMBOLS['want-to-see'].label },
  { name: 'maybe', label: PRIORITY_SYMBOLS.maybe.label },
  { name: 'clear', label: COPY.grid.clearPick },
];

/** `undefined` for an unknown action name, `null` for clear. */
export function priorityForAction(name: string): Priority | null | undefined {
  if (name === 'clear') return null;
  if (name === 'must' || name === 'want-to-see' || name === 'maybe') return name;
  return undefined;
}
