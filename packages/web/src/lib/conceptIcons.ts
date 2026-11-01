import { AlertTriangle, Clock, Flag, Gift, Home, ListChecks, MapPin, Zap, type LucideIcon } from 'lucide-react';
import type { ConceptIconKey } from '@festie/shared/constants';

/** Lucide icon for each named concept in COPY. One icon per concept, on web and mobile. */
export const CONCEPT_ICON: Record<ConceptIconKey, LucideIcon> = {
  nowNext: Zap,
  jumpToNow: Clock,
  picks: ListChecks,
  wrap: Gift,
  find: MapPin,
  homeBase: Home,
  meetUp: Flag,
  emergencySpot: AlertTriangle,
};
