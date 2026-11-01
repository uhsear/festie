// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Schedule diff for admin festival saves. Only a set that moved (day, stage,
 * start or end) or left the lineup alerts the people who picked it. A rename,
 * a new set, a link change or a map change alerts nobody.
 */

import { formatClock12 } from './time-zone.js';
import { MAX_BODY_LENGTH } from './notifications/payload.js';

export type SetSlot = { dayLabel: string; startTime: string | null; endTime: string | null; stageName: string | null };
export type ScheduleChange =
  | { kind: 'moved'; setId: string; artist: string; before: SetSlot; after: SetSlot }
  | { kind: 'removed'; setId: string; artist: string };
export type SchedulePush = { userId: string; title: string; body: string; setId?: string };

type IndexedSet = { dayKey: string; stageId: string | null; artist: string; slot: SetSlot };

function indexSets(festival: any): Map<string, IndexedSet> {
  const stageNames = new Map<string, string>();
  for (const stage of festival?.stages || []) stageNames.set(stage.id, stage.name);
  const sets = new Map<string, IndexedSet>();
  (festival?.days || []).forEach((day: any, dayIndex: number) => {
    for (const set of day?.sets || []) {
      const stageId = set.stageId || null;
      sets.set(set.id, {
        // Key the day by its date, so inserting or reordering a day does not move every later set.
        dayKey: day?.date || day?.label || `#${dayIndex}`,
        stageId,
        artist: set.artist || '',
        slot: {
          dayLabel: day.label || `Day ${dayIndex + 1}`,
          startTime: set.startTime || null,
          endTime: set.endTime || null,
          stageName: (stageId && stageNames.get(stageId)) || null,
        },
      });
    }
  });
  return sets;
}

/** `before` is the stored festival, `after` the sanitized payload. A day is identified by its date, then its label, then its position. */
export function diffPickedSchedule(before: any, after: any): ScheduleChange[] {
  const beforeSets = indexSets(before);
  const afterSets = indexSets(after);
  const changes: ScheduleChange[] = [];
  for (const [setId, old] of beforeSets) {
    const next = afterSets.get(setId);
    if (!next) {
      changes.push({ kind: 'removed', setId, artist: old.artist });
      continue;
    }
    if (
      (old.dayKey !== next.dayKey ||
        old.stageId !== next.stageId ||
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

function formatSlot(slot: SetSlot, withEnd: boolean): string {
  let text = `${slot.dayLabel} ${slot.startTime ? formatClock12(slot.startTime) : 'time to be announced'}`;
  if (withEnd && slot.endTime) text += ` to ${formatClock12(slot.endTime)}`;
  return slot.stageName ? `${text} at ${slot.stageName}` : text;
}

function describeOne(festivalName: string, change: ScheduleChange): { title: string; body: string } {
  if (change.kind === 'removed') {
    return {
      title: `${change.artist} is off the lineup`,
      body: `${festivalName} removed this set, so it is no longer in your picks.`,
    };
  }
  // When only the end time moved, the start-only slots would read the same, so show the end too.
  const withEnd = formatSlot(change.before, false) === formatSlot(change.after, false);
  return {
    title: `${change.artist} moved`,
    body: `Now ${formatSlot(change.after, withEnd)}. Was ${formatSlot(change.before, withEnd)}.`,
  };
}

/** One message per user who picked at least one changed set. */
export function buildSchedulePushes(
  festivalName: string,
  changes: ScheduleChange[],
  pickersBySet: Map<string, string[]>,
): SchedulePush[] {
  const changesByUser = new Map<string, ScheduleChange[]>();
  for (const change of changes) {
    for (const userId of new Set(pickersBySet.get(change.setId) || [])) {
      const list = changesByUser.get(userId) || [];
      list.push(change);
      changesByUser.set(userId, list);
    }
  }

  const pushes: SchedulePush[] = [];
  for (const [userId, userChanges] of changesByUser) {
    const [first, second] = userChanges as [ScheduleChange, ScheduleChange?];
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
    const names = rest > 0 ? `${first.artist}, ${second.artist} and ${rest} more` : `${first.artist} and ${second.artist}`;
    pushes.push({
      userId,
      title: `${userChanges.length} of your picks changed`,
      body: `${festivalName}: ${names}. Tap to see the new times.`.slice(0, MAX_BODY_LENGTH),
    });
  }
  return pushes;
}
