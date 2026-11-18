// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * adminFestivalTools.ts: pure helpers for the admin per-set engagement labels and venue coordinate parsing.
 * Shared by web and mobile so both apps show the same text.
 */

import { isValidLatLng } from './mapAuthoring';

export function setEngagementLabel(e: { picks: number; reminders: number } | undefined): string {
  if (!e) return '';
  if (e.picks === 0 && e.reminders === 0) return 'No picks or reminders yet';
  return `Picked by ${e.picks} · ${e.reminders} ${e.reminders === 1 ? 'reminder' : 'reminders'}`;
}

const LAT_LNG_RE = /^([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)$/;

/** Parses `lat, lng` or `lat lng`. Null for anything else or out of range. */
export function parseLatLng(text: string): { latitude: number; longitude: number } | null {
  const m = LAT_LNG_RE.exec((text ?? '').trim());
  if (!m) return null;
  const coord = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return isValidLatLng(coord) ? coord : null;
}
