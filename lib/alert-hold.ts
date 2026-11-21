// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The one gate every attendee alert that an organizer's save would send passes through (plan-v3 6.2).
 *
 * A platform admin's save sends as before. A member of an unverified organization never sends: the changes go
 * to festival_held_schedule_changes, and an admin releases or discards them from the review queue
 * (routes/organizations.ts). A member of a verified organization sends at once, at most `hourlyCap` runs per
 * festival per hour; a save past the cap is held for the admin like an unverified one. "Announce days" and the
 * set-time releases are admin-only actions in FESTIVAL_ACTIONS, so no organizer reaches them.
 */

import type { HeldAlert } from './db/stores/festival-review.js';

/** True for a signed-in member of an organization acting on the /manage mount, false for a platform admin. */
export const isOrganizerRequest = (req: { festivalRole?: string }) =>
  req.festivalRole !== undefined && req.festivalRole !== 'admin';

export type HoldResult = { held: boolean; changes: number; people: number };

export async function deliverScheduleAlert({
  stores,
  emitter,
  festival,
  alert,
  organizer,
  verified = false,
  hourlyCap,
}: {
  stores: any;
  emitter: any;
  festival: { id: string; name: string };
  alert: HeldAlert;
  organizer: boolean;
  verified?: boolean;
  hourlyCap?: number;
}): Promise<HoldResult> {
  const send = organizer ? verified && hourlyCap !== undefined && (await stores.festivalReview.takeAlertRun(festival.id, hourlyCap)) : true;
  if (send) {
    await emitter?.scheduleChanged?.({ festival, ...alert });
    return { held: false, changes: 0, people: 0 };
  }
  const { held, people } = await stores.festivalReview.hold(festival.id, alert);
  return { held: true, changes: held, people };
}
