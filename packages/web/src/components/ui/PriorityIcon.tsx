import type { LucideIcon } from 'lucide-react';
import { Star, Heart, Circle } from 'lucide-react';
import type { Priority } from '@festie/shared/types';
import { PRIORITY_SYMBOLS, type PrioritySymbolKey } from '@festie/shared/constants';

const ICONS: Record<PrioritySymbolKey, LucideIcon> = { star: Star, heart: Heart, circle: Circle };

export function priorityLucide(priority: Priority): LucideIcon {
  return ICONS[PRIORITY_SYMBOLS[priority].icon];
}

interface PriorityIconProps {
  priority: Priority;
  className?: string;
  /** Fill the glyph (active state). */
  filled?: boolean;
}

/** The single priority glyph for web: icon from the shared symbol set, decorative (pair it with a label). */
export default function PriorityIcon({ priority, className = 'w-4 h-4', filled = false }: PriorityIconProps) {
  const Icon = priorityLucide(priority);
  return <Icon className={className} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />;
}
