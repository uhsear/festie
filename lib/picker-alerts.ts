// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Which schedule changes alert the people who picked the sets, and who they are. The editor save
 * (routes/festivals.ts) and the lineup import commit (routes/lineup-import.ts) both call this.
 *
 * The per-date rule: a set that only got its first time (isTbaToTime) alerts its pickers when its date
 * already has a release row, because that date's festival-wide alert went out and the picker's only
 * notice is this one. On a date with no release row the alert is dropped: the release panel's alert
 * will cover the date, so a per-set alert would double up. Moves and removals always alert.
 */

import { diffPickedSchedule, isTbaToTime, type ScheduleChange } from './schedule-diff.js';

/** The date of each set in a festival, keyed by set id. A day with no date has none. */
function dateBySet(festival: any): Map<string, string> {
  const dates = new Map<string, string>();
  for (const day of festival?.days || []) {
    for (const set of day?.sets || []) if (day?.date) dates.set(set.id, day.date);
  }
  return dates;
}

/**
 * `before` is the stored festival and `after` the festival that results. `tbaOnly` is the import's mode:
 * only a first time on a released date alerts, and every other import change stays silent.
 * Read the pickers before the write, because a festival save deletes the picks of removed sets.
 */
export async function planPickerAlerts({
  stores,
  before,
  after,
  tbaOnly = false,
}: {
  stores: any;
  before: any;
  after: any;
  tbaOnly?: boolean;
}): Promise<{ changes: ScheduleChange[]; pickersBySet: Map<string, string[]> }> {
  let changes = diffPickedSchedule(before, after);
  if (tbaOnly) changes = changes.filter(isTbaToTime);
  if (changes.some(isTbaToTime)) {
    const released: Set<string> = await stores.timeReleases.releasedDates(before.id);
    const dates = dateBySet(after);
    changes = changes.filter((change) => {
      if (!isTbaToTime(change)) return true;
      const date = dates.get(change.setId);
      return !!date && released.has(date);
    });
  }
  const pickersBySet: Map<string, string[]> = changes.length
    ? await stores.profiles.pickersBySet(before.id, changes.map((change) => change.setId))
    : new Map();
  return { changes, pickersBySet };
}
