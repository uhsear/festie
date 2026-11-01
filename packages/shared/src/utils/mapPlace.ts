// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapPlace.ts — pure place-card, location-state and walk-time logic shared by the
 * web CrewMap and the mobile OfflineMap, so both show the same copy and math.
 */

import { buildPursuit, etaMinutes } from './geo';
import type { Coord } from './geo';
import { humanizeAmenityType } from './mapAuthoring';
import type { MapPin } from './mapPins';
import type { AmenityType, Stage } from '../types/domain';

/** Location state shared by web and mobile maps. */
export type GeoState = 'idle' | 'locating' | 'denied' | 'unavailable' | 'on';

/** Browser/expo error code to state: 1 = denied; anything else = unavailable. */
export function geoStateFromErrorCode(code: number | undefined): 'denied' | 'unavailable' {
  return code === 1 ? 'denied' : 'unavailable';
}

/** One line of copy for a location state. Empty string for 'on'. */
export function locationPromptCopy(state: GeoState, targetName?: string): string {
  switch (state) {
    case 'idle':
      return targetName ? `Turn on location to show the way to ${targetName}` : 'Turn on location to see how far it is';
    case 'locating':
      return 'Finding you…';
    case 'denied':
      return 'Location is blocked. Allow location for Festie in your settings, then try again.';
    case 'unavailable':
      return "Can't get a GPS fix. Move into the open and try again.";
    case 'on':
      return '';
  }
}

/** Amenity categories in chip order. */
export const MAP_AMENITY_CATEGORIES: AmenityType[] = [
  'water',
  'medical',
  'toilet',
  'food',
  'atm',
  'entrance',
  'exit',
  'info',
  'charging',
];

/** The "Nearest" quick targets, in order. */
export const NEAREST_AMENITY_TYPES: AmenityType[] = ['medical', 'water', 'toilet'];

/** Copy when no pin of the type is mapped. */
export function nearestMissingCopy(type: AmenityType): string {
  switch (type) {
    case 'medical':
      return 'No medical tent is mapped. Ask any staff member.';
    case 'water':
      return 'No water point is mapped. Ask any staff member.';
    case 'toilet':
      return 'No toilets are mapped. Ask any staff member.';
    default:
      return 'None is mapped. Ask any staff member.';
  }
}

export type MapPlaceKind = MapPin['kind'];

export interface MapPlace {
  /** The pin id (stage id, meeting-point id, amenity pin id). */
  id: string;
  kind: MapPlaceKind;
  /** pin.label */
  name: string;
  /** 'Stage' | 'Meeting point' | humanizeAmenityType(type) */
  kindLabel: string;
  coord: Coord;
  amenityType?: AmenityType;
}

export function placeFromPin(pin: MapPin): MapPlace {
  const kindLabel =
    pin.kind === 'stage' ? 'Stage' : pin.kind === 'meeting-point' ? 'Meeting point' : humanizeAmenityType(pin.amenityType ?? '');
  return {
    id: pin.id,
    kind: pin.kind,
    name: pin.label,
    kindLabel,
    coord: { latitude: pin.latitude, longitude: pin.longitude },
    ...(pin.amenityType ? { amenityType: pin.amenityType } : {}),
  };
}

/** Pursue-target id for a place: `place:<kind>:<id>`. Static coord, like amenities today. */
export function placeTargetId(place: MapPlace): string {
  return `place:${place.kind}:${place.id}`;
}

// toFixed(6) rounds the binary value (28.5383355 -> 28.538335); round half away from zero on the decimal instead.
function round6(n: number): string {
  return `${n < 0 ? '-' : ''}${(Math.round(Math.abs(n) * 1e6) / 1e6).toFixed(6)}`;
}

/** `https://maps.google.com/?q=<lat>,<lng>` with 6 decimals. */
export function externalMapUrl(coord: Coord): string {
  return `https://maps.google.com/?q=${round6(coord.latitude)},${round6(coord.longitude)}`;
}

/** `${name} (${kindLabel}): ${externalMapUrl(coord)}` */
export function placeShareText(place: MapPlace): string {
  return `${place.name} (${place.kindLabel}): ${externalMapUrl(place.coord)}`;
}

/** The place's walking line, `4 min walk · 310 m`, or null when there is no fix. */
export function placeWalkLine(self: Coord | null | undefined, place: MapPlace): string | null {
  const pursuit = buildPursuit(self, place.coord);
  return pursuit.etaLabel === '—' ? null : `${pursuit.etaLabel} walk · ${pursuit.distanceLabel}`;
}

/** The stage's coord when both numbers are finite, else null. */
export function stageCoord(
  stages: readonly Pick<Stage, 'id' | 'latitude' | 'longitude'>[] | null | undefined,
  stageId: string | null | undefined,
): Coord | null {
  if (!stages || !stageId) return null;
  const s = stages.find((st) => st.id === stageId);
  if (!s || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) return null;
  return { latitude: s.latitude as number, longitude: s.longitude as number };
}

/** A fix is recent when it is 5 minutes old or less. */
export const RECENT_FIX_MS = 300_000;

export function isFixRecent(fixAtMs: number | null | undefined, nowMs: number): boolean {
  return typeof fixAtMs === 'number' && Number.isFinite(fixAtMs) && nowMs - fixAtMs <= RECENT_FIX_MS;
}

/** Walk from origin to a stage, against the time left before startMs. */
export interface StageWalk {
  minutes: number;
  late: boolean;
  label: string;
}

export function walkToStage(
  origin: Coord | null,
  stage: Coord | null,
  startMs: number,
  nowMs: number,
): StageWalk | null {
  const minutes = etaMinutes(origin, stage);
  if (minutes === null) return null;
  const minutesLeft = Math.max(0, Math.floor((startMs - nowMs) / 60_000));
  return { minutes, late: minutes > minutesLeft, label: `${minutes} min walk` };
}

/** Metres per screen pixel at a latitude and MapLibre zoom (512 px tiles). */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);
}
