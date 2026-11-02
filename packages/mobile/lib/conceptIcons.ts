import type { Ionicons } from '@expo/vector-icons';
import type { ConceptIconKey } from '@festie/shared/constants';

type IconName = keyof typeof Ionicons.glyphMap;

// Ionicons for the shared concept keys. Same metaphor as web (lib/conceptIcons.ts).
export const CONCEPT_IONICON: Record<ConceptIconKey, IconName> = {
  nowNext: 'flash',
  jumpToNow: 'time-outline',
  picks: 'list',
  wrap: 'gift',
  find: 'location',
  homeBase: 'home',
  meetUp: 'flag',
  emergencySpot: 'warning',
};
