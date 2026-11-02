// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Link-preview image (og:image) for the public share page: a 1200x630 SVG that
 * routes/share.ts converts to PNG with sharp.
 */

import { escapeHtml } from './sanitize.js';
import { festivalStartMinutes } from '../time-zone.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** 24-hour `HH:MM`, the stored set time format. */
export const CLOCK_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ShareOgInput {
  username: string;
  festivalName: string;
  location: string;
  artists: string[];
  total: number;
  must: number;
}

function truncate(value: string, max: number) {
  const chars = [...String(value ?? '')];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** Returns the preview SVG. Every text value is escaped; escapeHtml's entities are valid XML. */
export function buildShareOgSvg(input: ShareOgInput): string {
  const text = (x: number, y: number, size: number, fill: string, value: string, weight = 400, anchor = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(value)}</text>`;

  const lines = [
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#080810"/>`,
    text(64, 88, 28, '#ff3366', 'FESTIE', 800),
    text(64, 170, 60, '#eaeaf2', truncate(input.festivalName, 32), 700),
    text(64, 226, 34, '#9999bb', `${input.username}'s picks`),
  ];
  input.artists.slice(0, 5).forEach((artist, i) => {
    lines.push(text(64, 300 + i * 46, 34, '#eaeaf2', truncate(artist, 28), 600));
  });
  lines.push(text(64, 580, 26, '#9999bb', `${input.total} sets · ${input.must} must-see`));
  if (input.location) lines.push(text(OG_WIDTH - 64, 580, 26, '#9999bb', truncate(input.location, 40), 400, 'end'));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">${lines.join('')}</svg>`;
}

const OG_RANK: Record<string, number> = { must: 0, 'want-to-see': 1 };

/** Up to 5 picked artist names: Must See first, then Want to See; each by day, then festival time, TBA last. */
export function pickOgArtists(festival: any, picks: Record<string, string>, sep: string): string[] {
  const rows: Array<{ name: string; rank: number; tba: number; day: number; minutes: number }> = [];
  (festival?.days || []).forEach((day: any, dayIndex: number) => {
    for (const set of day?.sets || []) {
      const rank = OG_RANK[picks?.[set.id] as string];
      if (rank === undefined) continue;
      const timed = CLOCK_TIME_RE.test(String(set.startTime || ''));
      const names = Array.isArray(set.artists) ? set.artists.map((a: any) => a?.name).filter(Boolean) : [];
      rows.push({
        name: names.length > 0 ? names.join(` ${sep} `) : String(set.artist || ''),
        rank,
        tba: timed ? 0 : 1,
        day: dayIndex,
        minutes: timed ? festivalStartMinutes(set.startTime) : 0,
      });
    }
  });
  rows.sort((a, b) => a.rank - b.rank || a.tba - b.tba || a.day - b.day || a.minutes - b.minutes);
  return rows.filter((r) => r.name).slice(0, 5).map((r) => r.name);
}
