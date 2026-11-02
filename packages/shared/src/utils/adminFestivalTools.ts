// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * adminFestivalTools.ts: pure helpers for the admin "Spotify links" view, the
 * backfill result copy, per-set engagement labels and venue coordinate parsing.
 * Shared by web and mobile so both apps show the same text.
 */

import type { SpotifyBackfillResult } from '../services/adminFestivalTools';
import { isValidLatLng } from './mapAuthoring';

export interface LooseFestivalDetail {
  stages?: { id?: string; name?: string }[];
  days?: {
    id?: string;
    label?: string;
    date?: string;
    sets?: {
      id?: string;
      artist?: string;
      stageId?: string | null;
      linkUrl?: string | null;
      artists?: { name?: string; links?: Record<string, string> }[];
    }[];
  }[];
}

export interface SetLinkArtist {
  index: number;
  name: string;
  spotifyUrl: string | null;
}
export interface SetLinkRow {
  setId: string;
  dayLabel: string;
  stageName: string;
  artists: SetLinkArtist[];
}

/** One row per set in day order then set order, with one entry per artist. */
export function setLinkRows(festival: LooseFestivalDetail): SetLinkRow[] {
  const stageNames = new Map<string, string>();
  for (const st of festival.stages ?? []) {
    if (st.id) stageNames.set(st.id, st.name ?? '');
  }
  const rows: SetLinkRow[] = [];
  (festival.days ?? []).forEach((day, dayIdx) => {
    const dayLabel = day.label || day.date || `Day ${dayIdx + 1}`;
    for (const set of day.sets ?? []) {
      let artists: SetLinkArtist[];
      if (set.artists && set.artists.length > 0) {
        artists = [];
        set.artists.forEach((a, index) => {
          const name = (a.name ?? '').trim();
          if (!name) return;
          artists.push({ index, name, spotifyUrl: a.links?.spotify ?? null });
        });
      } else {
        artists = [{ index: 0, name: set.artist ?? '', spotifyUrl: set.linkUrl || null }];
      }
      rows.push({
        setId: set.id ?? '',
        dayLabel,
        stageName: (set.stageId && stageNames.get(set.stageId)) || '',
        artists,
      });
    }
  });
  return rows;
}

/** Counts artists, not sets. */
export function linkCoverage(rows: SetLinkRow[]): { linked: number; total: number } {
  let linked = 0;
  let total = 0;
  for (const row of rows) {
    for (const a of row.artists) {
      total += 1;
      if (a.spotifyUrl) linked += 1;
    }
  }
  return { linked, total };
}

export function linkCoverageText(c: { linked: number; total: number }): string {
  return c.total === 0 ? 'No artists yet.' : `${c.linked} of ${c.total} artists have a Spotify link.`;
}

export function backfillSummary(r: SpotifyBackfillResult): string {
  if (r.total === 0) return 'Every set already has a link.';
  const base = `Linked ${r.updated} of ${r.total} sets.`;
  const k = r.unmatched?.length ?? 0;
  return k > 0 ? `${base} No match for ${k} ${k === 1 ? 'artist' : 'artists'}:` : base;
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
