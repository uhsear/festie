// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The one gate every attendee alert that an organizer's save would send passes through (plan-v3 6.2).
 *
 * A platform admin's save sends as before. A member of an organization never sends: the changes go to
 * festival_held_schedule_changes, and an admin releases or discards them from the review queue
 * (routes/organizations.ts). The routes that send other alerts (announcements, the lineup drop, "Announce
 * days", set-time releases) are admin-only actions in FESTIVAL_ACTIONS, so no organizer reaches them.
 *
 * shortcut: a verified organization is held too, so every organizer alert is reviewed. Direct sending for
 * verified organizations needs the confirm count and the hourly cap, which come with the trust tier.
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
}: {
  stores: any;
  emitter: any;
  festival: { id: string; name: string };
  alert: HeldAlert;
  organizer: boolean;
}): Promise<HoldResult> {
  if (!organizer) {
    await emitter?.scheduleChanged?.({ festival, ...alert });
    return { held: false, changes: 0, people: 0 };
  }
  const { held, people } = await stores.festivalReview.hold(festival.id, alert);
  return { held: true, changes: held, people };
}
