import type { AmenityType } from '@festie/shared/types';

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
