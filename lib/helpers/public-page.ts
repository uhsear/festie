// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Helpers shared by the server-rendered public pages: the pick share page
 * (routes/share.ts) and the festival page (lib/festival-page.ts).
 */

import { CLOCK_TIME_RE } from './share-og-image.js';
import { formatClock12 } from '../time-zone.js';

export function getStageNameById(stages: any, stageId: any) {
  const stage = (stages || []).find((s: any) => s.id === stageId);
  return stage?.name || 'TBD';
}

export function getStageColorById(stages: any, stageId: any) {
  const stage = (stages || []).find((s: any) => s.id === stageId);
  return stage?.color || '#666';
}

// Sanitize CSS color values to prevent style injection
export function sanitizeColor(color: any) {
  if (!color) return '#666';
  // Only allow hex colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return '#666';
}

// `9:30 PM – 10:45 PM`, `9:30 PM` with no end, `Time TBA` with no valid start.
export function shareTimeText(start: any, end: any) {
  if (!CLOCK_TIME_RE.test(String(start || ''))) return 'Time TBA';
  return formatClock12(start) + (CLOCK_TIME_RE.test(String(end || '')) ? ` – ${formatClock12(end)}` : '');
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// schema.org Event from raw festival values. The escapes keep a festival name
// from closing the <script> block; JSON-LD is data and does not run under the CSP.
export function buildEventJsonLd(festival: any, { shareUrl, ogUrl, description }: { shareUrl: string; ogUrl: string; description: string }) {
  // Festivals carry no start or end date of their own; the days' dates give the range.
  const dates = (festival.days || [])
    .map((day: any) => String(day?.date || ''))
    .filter((date: string) => ISO_DATE_RE.test(date))
    .map((date: string) => date.slice(0, 10))
    .sort();
  const event: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: festival.name,
    ...(dates.length > 0 ? { startDate: dates[0], endDate: dates[dates.length - 1] } : {}),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    url: shareUrl,
    image: [ogUrl],
    description,
  };
  if (festival.location) {
    const hasGeo = Number.isFinite(festival.latitude) && Number.isFinite(festival.longitude);
    event.location = {
      '@type': 'Place',
      name: festival.location,
      address: festival.location,
      ...(hasGeo ? { geo: { '@type': 'GeoCoordinates', latitude: festival.latitude, longitude: festival.longitude } } : {}),
    };
  }
  return JSON.stringify(event).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
