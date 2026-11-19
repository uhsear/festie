// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Schedule diff for admin festival saves. Only a set that moved (day, stage,
 * start or end) or left the lineup alerts the people who picked it or set a
 * reminder on it. A rename,
 * a new set, a link change or a map change alerts nobody.
 * An announced act that turns cancelled alerts the people whose mark on it is still open.
 */

import { festivalStartMinutes, formatClock12 } from './time-zone.js';
import { MAX_BODY_LENGTH } from './notifications/payload.js';

// dayKey and stageId are the identity; dayLabel and stageName are display text that an admin can rename.
type SetSlot = {
  dayKey: string;
  dayLabel: string;
  startTime: string | null;
  endTime: string | null;
  stageId: string | null;
  stageName: string | null;
};
export type SetChange =
  | { kind: 'moved'; setId: string; artist: string; before: SetSlot; after: SetSlot }
  | { kind: 'removed'; setId: string; artist: string };
/** `setIds` are the stored sets that covered the act. The festival route fills them in. */
export type EntryCancelled = { kind: 'entry_cancelled'; entryId: string; artist: string; setIds?: string[] };
export type ScheduleChange = SetChange | EntryCancelled;
export type SchedulePush = { userId: string; title: string; body: string; setId?: string };

type IndexedSet = { artist: string; slot: SetSlot };

function indexSets(festival: any): Map<string, IndexedSet> {
  const stageNames = new Map<string, string>();
  for (const stage of festival?.stages || []) stageNames.set(stage.id, stage.name);
  const sets = new Map<string, IndexedSet>();
  (festival?.days || []).forEach((day: any, dayIndex: number) => {
    for (const set of day?.sets || []) {
      const stageId = set.stageId || null;
      sets.set(set.id, {
        artist: set.artist || '',
        slot: {
          // Key the day by its date, so inserting or reordering a day does not move every later set.
          dayKey: day?.date || day?.label || `#${dayIndex}`,
          dayLabel: day.label || `Day ${dayIndex + 1}`,
          startTime: set.startTime || null,
          endTime: set.endTime || null,
          stageId,
          stageName: (stageId && stageNames.get(stageId)) || null,
        },
      });
    }
  });
  return sets;
}

/** `before` is the stored festival, `after` the sanitized payload. A day is identified by its date, then its label, then its position. */
export function diffPickedSchedule(before: any, after: any): SetChange[] {
  const beforeSets = indexSets(before);
  const afterSets = indexSets(after);
  const changes: SetChange[] = [];
  for (const [setId, old] of beforeSets) {
    const next = afterSets.get(setId);
    if (!next) {
      changes.push({ kind: 'removed', setId, artist: old.artist });
      continue;
    }
    if (
      (old.slot.dayKey !== next.slot.dayKey ||
        old.slot.stageId !== next.slot.stageId ||
        old.slot.startTime !== next.slot.startTime ||
        old.slot.endTime !== next.slot.endTime) &&
      // A change the alert cannot describe ("Now Fri 10 PM. Was Fri 10 PM.") alerts nobody.
      formatSlot(old.slot, true) !== formatSlot(next.slot, true)
    ) {
      changes.push({ kind: 'moved', setId, artist: next.artist || old.artist, before: old.slot, after: next.slot });
    }
  }
  return changes;
}

/**
 * Announced acts that the save turns cancelled. An entry that is new, or already cancelled, alerts nobody.
 * `before` is the stored festival, `after` the sanitized payload.
 */
export function diffCancelledEntries(before: any, after: any): EntryCancelled[] {
  const stored = new Map<string, any>((before?.lineup || []).map((entry: any) => [entry.id, entry]));
  const sep = after?.b2bSeparator || 'b2b';
  return (after?.lineup || [])
    .filter((entry: any) => entry.status === 'cancelled' && stored.get(entry.id)?.status === 'announced')
    .map((entry: any) => ({
      kind: 'entry_cancelled' as const,
      entryId: entry.id,
      artist: entry.displayName || (entry.artists || []).map((artist: any) => artist.name).join(` ${sep} `),
    }));
}

/** True when a set only got its first start time: same day, same stage, TBA before. */
export function isTbaToTime(change: ScheduleChange): boolean {
  return (
    change.kind === 'moved' &&
    change.before.startTime === null &&
    change.after.startTime !== null &&
    change.before.dayKey === change.after.dayKey &&
    change.before.stageId === change.after.stageId
  );
}

function formatSlot(slot: SetSlot, withEnd: boolean): string {
  let text = `${slot.dayLabel} ${slot.startTime ? formatClock12(slot.startTime) : 'time to be announced'}`;
  if (withEnd && slot.endTime) text += ` to ${formatClock12(slot.endTime)}`;
  return slot.stageName ? `${text} at ${slot.stageName}` : text;
}

function describeOne(festivalName: string, change: SetChange): { title: string; body: string } {
  if (change.kind === 'removed') {
    return {
      title: `${change.artist} is off the lineup`,
      body: `${festivalName} removed this set, so it is no longer in your picks.`,
    };
  }
  if (isTbaToTime(change)) {
    return { title: `${change.artist} has a set time`, body: `${formatSlot(change.after, false)}.` };
  }
  // When only the end time moved, the start-only slots would read the same, so show the end too.
  const withEnd = formatSlot(change.before, false) === formatSlot(change.after, false);
  return {
    title: `${change.artist} moved`,
    body: `Now ${formatSlot(change.after, withEnd)}. Was ${formatSlot(change.before, withEnd)}.`,
  };
}

/** `+30 min`, `-15 min`, `+1 h`, `+1 h 30 min`. */
export function formatShiftDelta(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}

/** The stage and minutes when every change is the same bulk shift on one stage and day, else null. */
function shiftOf(changes: SetChange[]): { stageName: string; delta: number } | null {
  let shift: { stageId: string; dayKey: string; stageName: string; delta: number } | null = null;
  for (const change of changes) {
    if (change.kind !== 'moved') return null;
    const { before, after } = change;
    if (!before.stageId || !after.stageName || before.stageId !== after.stageId || before.dayKey !== after.dayKey) {
      return null;
    }
    if (!before.startTime || !after.startTime) return null;
    const delta = festivalStartMinutes(after.startTime) - festivalStartMinutes(before.startTime);
    // The bound rejects a slot that crosses the 06:00 festival-day start (05:45 to 06:15 reads -1410).
    if (delta === 0 || Math.abs(delta) > 360) return null;
    if (
      before.endTime &&
      after.endTime &&
      festivalStartMinutes(after.endTime) - festivalStartMinutes(before.endTime) !== delta
    ) {
      return null;
    }
    if (!shift) shift = { stageId: before.stageId, dayKey: before.dayKey, stageName: after.stageName, delta };
    else if (shift.stageId !== before.stageId || shift.dayKey !== before.dayKey || shift.delta !== delta) return null;
  }
  return shift && { stageName: shift.stageName, delta: shift.delta };
}

/**
 * One message per user who picked at least one changed set or set a reminder on it, then one per
 * user whose mark on a cancelled act is still open. A user whose set alert already says the act left the
 * lineup (a removed set that covered it) gets no second one; any other set alert does not cover the act.
 */
export function buildSchedulePushes(
  festivalName: string,
  changes: ScheduleChange[],
  pickersBySet: Map<string, string[]>,
  interestedByEntry: Map<string, string[]> = new Map(),
): SchedulePush[] {
  const changesByUser = new Map<string, SetChange[]>();
  for (const change of changes) {
    if (change.kind === 'entry_cancelled') continue;
    for (const userId of new Set(pickersBySet.get(change.setId) || [])) {
      const list = changesByUser.get(userId) || [];
      list.push(change);
      changesByUser.set(userId, list);
    }
  }

  const pushes: SchedulePush[] = [];
  for (const [userId, userChanges] of changesByUser) {
    const [first, second] = userChanges as [SetChange, SetChange?];
    if (!second) {
      const { title, body } = describeOne(festivalName, first);
      pushes.push({
        userId,
        title,
        body: body.slice(0, MAX_BODY_LENGTH),
        ...(first.kind === 'moved' ? { setId: first.setId } : {}),
      });
      continue;
    }
    const rest = userChanges.length - 2;
    const names =
      rest > 0 ? `${first.artist}, ${second.artist} and ${rest} more` : `${first.artist} and ${second.artist}`;
    const shift = shiftOf(userChanges);
    pushes.push({
      userId,
      title: shift
        ? `${shift.stageName}: ${userChanges.length} of your picks moved ${formatShiftDelta(shift.delta)}`
        : `${userChanges.length} of your picks changed`,
      body: `${festivalName}: ${names}. Tap to see the new times.`.slice(0, MAX_BODY_LENGTH),
    });
  }
  return [...pushes, ...buildCancelPushes(festivalName, changes, interestedByEntry, changesByUser)];
}

function buildCancelPushes(
  festivalName: string,
  changes: ScheduleChange[],
  interestedByEntry: Map<string, string[]>,
  setChangesByUser: Map<string, SetChange[]>,
): SchedulePush[] {
  const artistsByUser = new Map<string, string[]>();
  for (const change of changes) {
    if (change.kind !== 'entry_cancelled') continue;
    for (const userId of new Set(interestedByEntry.get(change.entryId) || [])) {
      const told = (setChangesByUser.get(userId) || []).some(
        (setChange) => setChange.kind === 'removed' && (change.setIds || []).includes(setChange.setId),
      );
      if (told) continue;
      artistsByUser.set(userId, [...(artistsByUser.get(userId) || []), change.artist]);
    }
  }
  return [...artistsByUser].map(([userId, [first, second, ...rest]]) => {
    if (!second) {
      return { userId, title: `${first} is off the lineup`, body: `${festivalName} cancelled this act.`.slice(0, MAX_BODY_LENGTH) };
    }
    const names = rest.length > 0 ? `${first}, ${second} and ${rest.length} more` : `${first} and ${second}`;
    return {
      userId,
      title: `${2 + rest.length} acts you marked are off the lineup`,
      body: `${festivalName}: ${names}.`.slice(0, MAX_BODY_LENGTH),
    };
  });
}
