import { PRIORITY_OPTIONS } from '../constants/config';
import type { Priority } from '../types';

export type PickMenuKey = Priority | 'remove';

export interface PickMenuItem {
  key: PickMenuKey;
  label: string;
  selected: boolean;
}

/** Items for the long-press pick menu: one per priority, plus "Remove pick" when a pick is set. */
export function pickMenuItems(current: Priority | null): PickMenuItem[] {
  const items: PickMenuItem[] = PRIORITY_OPTIONS.map((o) => ({
    key: o.value,
    label: o.label,
    selected: o.value === current,
  }));
  if (current) items.push({ key: 'remove', label: 'Remove pick', selected: false });
  return items;
}

/** The pick a menu choice produces. Removing, or choosing the current priority again, clears it. */
export function nextPickFromMenu(current: Priority | null, key: PickMenuKey): Priority | null {
  return key === 'remove' || key === current ? null : key;
}
