// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * What an organizer may learn about attendee interest in its own festival (owner decision 4, plan-v3 6.6):
 * aggregates only. A festival with fewer than ENGAGEMENT_MIN_JOINED joined users shows nothing, and any single
 * count below ENGAGEMENT_MIN_COUNT is hidden (null), so a number never points at one person.
 */

export const ENGAGEMENT_MIN_JOINED = 20;
export const ENGAGEMENT_MIN_COUNT = 5;

type SetEngagement = { picks: number | null; reminders: number | null };
export type OrganizerEngagement = { available: boolean; minJoined: number; minCount: number; sets: Record<string, SetEngagement> };

const shown = (count: number) => (count >= ENGAGEMENT_MIN_COUNT ? count : null);

export function organizerEngagement(
  joined: number,
  picks: Array<{ setId: string; picks: number }>,
  reminders: Array<{ setId: string; reminders: number }>,
): OrganizerEngagement {
  const base = { minJoined: ENGAGEMENT_MIN_JOINED, minCount: ENGAGEMENT_MIN_COUNT };
  if (joined < ENGAGEMENT_MIN_JOINED) return { available: false, ...base, sets: {} };
  // A Map: set ids are data, and one could be "__proto__".
  const sets = new Map<string, { picks: number; reminders: number }>();
  for (const row of picks) sets.set(row.setId, { picks: row.picks, reminders: 0 });
  for (const row of reminders) sets.set(row.setId, { picks: sets.get(row.setId)?.picks ?? 0, reminders: row.reminders });
  const visible = new Map<string, SetEngagement>();
  for (const [setId, counts] of sets) visible.set(setId, { picks: shown(counts.picks), reminders: shown(counts.reminders) });
  return { available: true, ...base, sets: Object.fromEntries(visible) };
}

/** An audience size for an organizer: hidden (null) while fewer than ENGAGEMENT_MIN_JOINED people are in it. */
export const organizerAudience = (count: number): number | null => (count >= ENGAGEMENT_MIN_JOINED ? count : null);
