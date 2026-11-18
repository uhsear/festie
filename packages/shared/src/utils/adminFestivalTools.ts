// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * adminFestivalTools.ts: pure helpers for the admin Artists screen's backfill result copy,
 * per-set engagement labels and venue coordinate parsing.
 * Shared by web and mobile so both apps show the same text.
 */

import type { SpotifyBackfillResult } from '../services/adminFestivalTools';
import { isValidLatLng } from './mapAuthoring';

export function backfillSummary(r: SpotifyBackfillResult): string {
  if (r.total === 0) return 'Every set already has a link.';
  const base = `Linked ${r.updated} of ${r.total} sets.`;
  const k = r.unmatched?.length ?? 0;
  const shared = r.skippedShared?.length ?? 0;
  const sharedNote = shared > 0 ? ` ${shared} ${shared === 1 ? 'artist is' : 'artists are'} on other festivals. Add their links on the Artists tab.` : '';
  return `${k > 0 ? `${base} No match for ${k} ${k === 1 ? 'artist' : 'artists'}:` : base}${sharedNote}`;
}

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
