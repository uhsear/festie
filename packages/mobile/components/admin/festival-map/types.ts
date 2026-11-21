import type { AmenityType } from '@festie/shared/types';

// Local editable stage shape (carries the pin). Mirrors festivalEditState.StageRow.
export interface StageEdit {
  id: string;
  name: string;
  color: string;
  latitude: number | null;
  longitude: number | null;
}

// What the next placement tap will do. null = idle (no target armed).
export type ArmedTarget =
  | { kind: 'stage'; stageId: string }
  | { kind: 'amenity'; amenityType: AmenityType }
  | { kind: 'zone' }
  | { kind: 'siteplan' }
  | { kind: 'venue' }
  | { kind: 'move-amenity'; id: string }
  | { kind: 'move-zone'; id: string }
  | null;

/** A single tapped vertex while drawing a zone (geo.ts {latitude, longitude}). */
export type Vertex = { latitude: number; longitude: number };
