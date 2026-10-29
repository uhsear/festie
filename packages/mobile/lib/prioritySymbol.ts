import type { Ionicons } from '@expo/vector-icons';
import { PRIORITY_OPTIONS, PRIORITY_SYMBOLS, type PrioritySymbolKey } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';

type IconName = keyof typeof Ionicons.glyphMap;

// Ionicons for the shared priority symbol keys. Same metaphor as web (Lucide Star/Heart/Circle).
const IONICON: Record<PrioritySymbolKey, IconName> = { star: 'star', heart: 'heart', circle: 'ellipse' };

export function priorityIconName(priority: Priority): IconName {
  return IONICON[PRIORITY_SYMBOLS[priority].icon];
}

/** Priority controls in display order: value, icon, full label and short label. */
export const PRIORITY_BUTTONS: readonly { value: Priority; icon: IconName; label: string; short: string }[] =
  PRIORITY_OPTIONS.map(({ value }) => ({
    value,
    icon: priorityIconName(value),
    label: PRIORITY_SYMBOLS[value].label,
    short: PRIORITY_SYMBOLS[value].short,
  }));
