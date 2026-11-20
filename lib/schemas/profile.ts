// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { PICK_PRIORITY_VALUES, REMINDER_MINUTE_VALUES } from '../constants';
import { identifier, shortText } from './primitives';

// ════════════════════════════════════════════════════════════════════════════════
// Profile & Festival Participation Schemas
// ════════════════════════════════════════════════════════════════════════════════

const pickValue = z.enum(PICK_PRIORITY_VALUES);
const picksMap = z.record(z.string().max(100), pickValue).optional();
// A delta changes only the sets it names: a priority sets the pick, null removes it.
// Sets the delta leaves out keep whatever the server holds, so a replayed offline
// write cannot erase picks that arrived after the device last synced.
const pickDeltasMap = z
  .record(z.string().max(100), pickValue.nullable())
  .refine((d) => Object.keys(d).length > 0, { message: 'pickDeltas needs at least one set' })
  .optional();
const notesMap = z.record(z.string().max(100), shortText).optional();
const allowedReminderMinutes = z.union(
  REMINDER_MINUTE_VALUES.map((m) => z.literal(m)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]],
);
const remindersMap = z.record(z.string().max(100), allowedReminderMinutes).optional();

export const profileUpdateSchema = z
  .object({
    picks: picksMap,
    pickDeltas: pickDeltasMap,
    notes: notesMap,
    reminders: remindersMap,
    // Set ids the user cleared in this full-map write. They end the server's 72-hour guard on converted picks.
    pickRemove: z.array(z.string().max(100)).max(200).optional(),
    // Interest marks travel as deltas, never as a whole map, so two devices cannot erase each other's marks.
    interestAdd: z.array(identifier).max(50).optional(),
    interestRemove: z.array(identifier).max(50).optional(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== undefined), {
    message: 'At least one field required',
  })
  .refine((d) => d.picks === undefined || d.pickDeltas === undefined, {
    message: 'Send either picks or pickDeltas, not both',
    path: ['pickDeltas'],
  });

export const joinFestivalSchema = z.object({
  festivalId: identifier,
});
