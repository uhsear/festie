import type { FestivalDay, FestivalSet, Stage } from '../types/domain';
import { artistDisplayName, formatTime } from './format';
import { getSetTimeBounds } from './setStatus';

/** One set as it was drawn on a saved lock-screen image. */
export interface SavedImageSet {
  id: string;
  artist: string;
  start: string;
  end: string;
  stageId: string;
}

/** What a saved lock-screen image showed for one day, kept on the device. */
export interface SavedImageRecord {
  v: 1;
  festivalId: string;
  dayIndex: number;
  savedAt: number;
  sets: SavedImageSet[];
}

export interface LockscreenChange {
  setId: string;
  text: string;
}

/** Storage key for the image saved for one festival day. */
export const lockscreenSavedKey = (festivalId: string, dayIndex: number) =>
  `festie.lockscreen.saved.${festivalId}.${dayIndex}`;

const snapshotOf = (set: FestivalSet, b2bSeparator?: string): SavedImageSet => ({
  id: set.id,
  artist: artistDisplayName(set, b2bSeparator),
  start: set.startTime ?? '',
  end: set.endTime ?? '',
  stageId: set.stageId ?? '',
});

/** The record to store when the user saves an image of `setIds` for one day. */
export function lockscreenSnapshot(args: {
  festivalId: string;
  dayIndex: number;
  setIds: string[];
  sets: FestivalSet[];
  b2bSeparator?: string;
  savedAt: number;
}): SavedImageRecord {
  const byId = new Map(args.sets.map((s) => [s.id, s]));
  return {
    v: 1,
    festivalId: args.festivalId,
    dayIndex: args.dayIndex,
    savedAt: args.savedAt,
    sets: args.setIds.flatMap((id) => {
      const set = byId.get(id);
      return set ? [snapshotOf(set, args.b2bSeparator)] : [];
    }),
  };
}

/** A stored record, or null when the JSON is missing, malformed or from another version. */
export function parseSavedImageRecord(raw: string | null): SavedImageRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<SavedImageRecord>;
    if (r.v !== 1 || typeof r.festivalId !== 'string' || typeof r.dayIndex !== 'number' || !Array.isArray(r.sets)) return null;
    return r as SavedImageRecord;
  } catch {
    return null;
  }
}

const time = (hhmm: string) => (hhmm ? formatTime(hhmm) : 'TBA');

/**
 * What changed in the lineup since the image was saved: a moved time, a new stage, a new
 * name, or a set gone from the lineup. Pick changes are the user's own and are not listed.
 */
export function lockscreenChanges(
  record: SavedImageRecord,
  sets: FestivalSet[],
  stages: Stage[],
  b2bSeparator?: string,
): LockscreenChange[] {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const out: LockscreenChange[] = [];
  for (const was of record.sets) {
    const set = byId.get(was.id);
    if (!set) {
      out.push({ setId: was.id, text: `${was.artist} is no longer in the lineup` });
      continue;
    }
    const now = snapshotOf(set, b2bSeparator);
    if (now.start !== was.start) {
      out.push({ setId: was.id, text: `${now.artist} moved ${time(was.start)} → ${time(now.start)}` });
    } else if (now.end !== was.end) {
      out.push({ setId: was.id, text: `${now.artist} now ends ${time(now.end)}` });
    } else if (now.stageId !== was.stageId) {
      out.push({ setId: was.id, text: `${now.artist} moved to ${stageName.get(now.stageId) ?? 'another stage'}` });
    } else if (now.artist !== was.artist) {
      out.push({ setId: was.id, text: `${was.artist} is now ${now.artist}` });
    }
  }
  return out;
}

/** Banner text naming at most two changes, then "+N more". Empty when nothing changed. */
export function lockscreenChangeText(changes: LockscreenChange[]): string {
  if (!changes.length) return '';
  const named = changes.slice(0, 2).map((c) => c.text).join('. ');
  const more = changes.length > 2 ? ` +${changes.length - 2} more.` : '.';
  return `${named}${more} Your lock-screen image is out of date.`;
}

/** True once every set on the saved image has ended, so a warning no longer helps. */
export function savedImageExpired(
  record: SavedImageRecord,
  sets: FestivalSet[],
  days: FestivalDay[],
  nowMs: number,
  timeZone?: string,
): boolean {
  const byId = new Map(sets.map((s) => [s.id, s]));
  return record.sets.every((was) => {
    const set = byId.get(was.id);
    const bounds = set ? getSetTimeBounds(set, days, timeZone) : null;
    return bounds == null || bounds.endMs <= nowMs;
  });
}
