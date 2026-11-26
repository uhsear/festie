// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Link-preview images (og:image) for the public share and festival pages: 1200x630
 * SVGs that routes/share.ts and routes/pages.ts convert to PNG with sharp.
 *
 * The lockup is baked as paths (copied from docs/brand/festie-lockup.svg), so the brand needs no
 * server font. Festival names, dates and artist names are live text in the server's sans font:
 * outlining arbitrary text needs a bundled font file, and a font change on the production host is
 * an owner decision.
 */

import { escapeHtml } from './sanitize.js';
import { colors } from '../../packages/shared/src/tokens/colors';
import { posterBand } from '../../packages/shared/src/utils/festivalTint';
import { festivalStartMinutes } from '../time-zone.js';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MARGIN = 64;
/** Height of the festival-hue band on the festival card (POSTER.band.height). */
const BAND_HEIGHT = 24;

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

const text = (x: number, y: number, size: number, fill: string, value: string, weight = 400, anchor = 'start') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(value)}</text>`;

/** Horizontal lockup (mark and mixed-case wordmark) from a 683x199 box, drawn `height` px tall. */
const lockup = (x: number, y: number, height: number) =>
  `<g transform="translate(${x} ${y}) scale(${height / 199})">` +
  `<g transform="translate(-84.25 -84.25) scale(0.7292)"><path fill="${colors.accent.coral}" d="M132 372 212 372 256 300 250.11 290.08 249.72 289.78 249.35 289.47 248.99 289.13 248.65 288.79 248.33 288.42 248.03 288.04 247.75 287.65 245.89 284.94 244.07 282.29 242.26 279.69 240.48 277.13 238.72 274.62 235.26 269.72 227.04 258.10 223.95 253.70 222.44 251.53 220.96 249.39 219.51 247.28 218.09 245.18 216.66 243.05 215.07 240.64ZM256 300 300 372 380 372 296.93 240.64 295.34 243.05 293.91 245.18 292.49 247.28 291.04 249.39 289.56 251.53 288.05 253.70 284.96 258.10 276.74 269.72 273.28 274.62 271.52 277.13 269.74 279.69 267.93 282.29 266.11 284.94 264.25 287.65 263.97 288.04 263.67 288.42 263.35 288.79 263.01 289.13 262.65 289.47 262.28 289.78 261.89 290.08Z"/>` +
  `<path fill="${colors.accent.aqua}" fill-rule="evenodd" d="M256 282c-30-44-52-68-52-98a52 52 0 0 1 104 0c0 30-22 54-52 98zm0-78a20 20 0 1 0 0-40 20 20 0 0 0 0 40z"/></g>` +
  `<path fill="${colors.text.primary}" transform="translate(227 147.5)" d="M31.24 0V-33.39H87.98V-57.46H31.24V-71.79H90.13V-96H4.3V0ZM137.41 1.43C161.77 1.43 177.1 -9.89 177.1 -25.93V-27.65H150.16V-26.08C150.16 -21.78 147.3 -19.92 136.41 -19.92C124.94 -19.92 121.07 -22.35 120.64 -31.09H177.24C177.53 -33.67 177.67 -35.53 177.67 -37.97C177.67 -61.18 161.77 -73.65 136.84 -73.65C112.76 -73.65 95.71 -59.61 95.71 -36.11C95.71 -9.03 112.91 1.43 137.41 1.43ZM136.26 -53.01C146.29 -53.01 150.59 -50.87 151.59 -44.7H121.07C122.22 -50.87 126.38 -53.01 136.26 -53.01ZM223.67 1.43C247.59 1.43 261.06 -8.31 261.06 -21.78C261.06 -33.96 254.33 -40.98 233.27 -43.27L218.94 -44.85C210.48 -45.71 209.34 -46.71 209.34 -48.72C209.34 -51.44 210.48 -52.59 219.22 -52.59C230.11 -52.59 231.55 -50.87 231.55 -47.14V-46.28H258.48V-46.85C258.48 -64.62 245.16 -73.65 220.08 -73.65C193 -73.65 182.83 -62.61 182.83 -49.86C182.83 -37.68 190.85 -30.66 205.76 -29.09L226.67 -26.79C233.41 -26.08 234.56 -25.5 234.56 -23.21C234.56 -20.78 233.12 -19.77 223.81 -19.77C214.07 -19.77 211.49 -20.2 211.49 -24.21V-25.65H184.55V-25.07C184.55 -8.45 198.16 1.43 223.67 1.43ZM321.53 0V-24.21H308.63C302.47 -24.21 300.75 -25.65 300.75 -31.38V-50.15H321.53V-72.21H300.75V-84.68H273.81V-72.21H263.21V-50.15H273.81V-27.51C273.81 -8.74 284.56 0 302.61 0ZM354.91 -78.81V-96H327.98V-78.81ZM354.91 0V-72.21H327.98V0ZM403.77 1.43C428.13 1.43 443.46 -9.89 443.46 -25.93V-27.65H416.53V-26.08C416.53 -21.78 413.66 -19.92 402.77 -19.92C391.31 -19.92 387.44 -22.35 387.01 -31.09H443.61C443.89 -33.67 444.04 -35.53 444.04 -37.97C444.04 -61.18 428.13 -73.65 403.2 -73.65C379.13 -73.65 362.08 -59.61 362.08 -36.11C362.08 -9.03 379.27 1.43 403.77 1.43ZM402.63 -53.01C412.66 -53.01 416.96 -50.87 417.96 -44.7H387.44C388.59 -50.87 392.74 -53.01 402.63 -53.01Z"/></g>`;

/** Ground, the two rays of og-image.png and a soft aqua glow. Every card starts from this frame. */
const frame = () =>
  `<defs><linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.09"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
  `<radialGradient id="glow" cx="1" cy="1" r="0.8"><stop offset="0" stop-color="${colors.accent.aqua}" stop-opacity="0.16"/><stop offset="1" stop-color="${colors.accent.aqua}" stop-opacity="0"/></radialGradient></defs>` +
  `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${colors.bg.primary}"/>` +
  `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#glow)"/>` +
  `<polygon points="760,0 880,0 1060,630 700,630" fill="url(#ray)"/>` +
  `<polygon points="930,0 1010,0 1200,630 980,630" fill="url(#ray)"/>`;

const svgDocument = (lines: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">${frame()}${lines.join('')}</svg>`;

/** Shorter festival names get larger type. */
const headlineSize = (name: string) => ([...name].length <= 16 ? 84 : [...name].length <= 24 ? 68 : 54);

/**
 * Returns the plan card SVG: the festival, then the picks as a stack with Must See largest.
 * Aqua only: the plan card never carries the festival hue. Every text value is escaped;
 * escapeHtml's entities are valid XML.
 */
export function buildShareOgSvg(input: ShareOgInput): string {
  const lines = [
    lockup(MARGIN, 52, 56),
    `<rect x="0" y="0" width="8" height="${OG_HEIGHT}" fill="${colors.accent.aqua}"/>`,
    text(MARGIN, 172, 54, colors.text.primary, truncate(input.festivalName, 32), 700),
    text(MARGIN, 220, 30, colors.text.secondary, `${input.username}'s picks`),
  ];
  // pickOgArtists lists Must See first, so the first `must` rows are the Must picks.
  let y = 296;
  input.artists.slice(0, 5).forEach((artist, i) => {
    const isMust = i < input.must;
    const size = isMust ? 46 : 32;
    const dot = isMust ? colors.priority.must : colors.priority.want;
    lines.push(`<circle cx="${MARGIN + 10}" cy="${y - size * 0.32}" r="${isMust ? 9 : 6}" fill="${dot}"/>`);
    lines.push(text(MARGIN + 36, y, size, isMust ? colors.text.primary : colors.text.secondary, truncate(artist, 28), isMust ? 700 : 500));
    y += isMust ? 58 : 46;
  });
  lines.push(text(MARGIN, 592, 26, colors.text.secondary, `${input.total} sets · ${input.must} must-see`));
  if (input.location) lines.push(text(OG_WIDTH - MARGIN, 592, 26, colors.text.secondary, truncate(input.location, 40), 400, 'end'));

  return svgDocument(lines);
}

export interface FestivalOgInput {
  festivalName: string;
  dateRange: string | null;
  location: string;
  setCount: number;
  stageCount: number;
  /** Announced acts with no sets yet. With zero sets the image counts these instead of "0 sets". */
  announcedCount?: number;
}

/**
 * Preview SVG for the public festival page (/f/<slug>/og.png): the festival name, a large date
 * line and a count line. The one band along the top edge carries the festival hue (OD-4 C);
 * `posterBand` swaps in the neutral stage colour when the hue is near coral or aqua or too dark.
 */
export function buildFestivalOgSvg(input: FestivalOgInput): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const festivalName = truncate(input.festivalName, 32);
  const lines = [
    `<rect x="0" y="0" width="${OG_WIDTH}" height="${BAND_HEIGHT}" fill="${posterBand(input.festivalName).colour}"/>`,
    lockup(MARGIN, 76, 56),
    text(MARGIN, 280, headlineSize(festivalName), colors.text.primary, festivalName, 700),
  ];
  if (input.dateRange) lines.push(text(MARGIN, 366, 52, colors.accent.aqua, input.dateRange, 700));
  const stages = plural(input.stageCount, 'stage');
  const announced = input.setCount === 0 ? (input.announcedCount ?? 0) : 0;
  const summary =
    announced > 0
      ? `${plural(announced, 'act')} announced${input.stageCount > 0 ? ` · ${stages}` : ''}`
      : `${plural(input.setCount, 'set')} · ${stages}`;
  lines.push(text(MARGIN, 440, 38, colors.text.primary, summary, 500));
  if (input.location) lines.push(text(MARGIN, 592, 28, colors.text.secondary, truncate(input.location, 48)));
  return svgDocument(lines);
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
        name: set.displayName || (names.length > 0 ? names.join(` ${sep} `) : String(set.artist || '')),
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
