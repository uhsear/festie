// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { MEETING_POINT_TYPES } from '../constants';
import { identifier } from './primitives';
import { noMarkup, noMarkupMsg } from './account';

// ── Crew schemas ─────────────────────────────────────────────────────
export const crewCreateSchema = z.object({
  name: z.string().trim().min(1, 'Crew name required').max(60).refine(noMarkup, noMarkupMsg),
  festivalId: identifier,
  totemName: z.string().trim().max(40).optional(),
  totemEmoji: z.string().trim().max(16).optional(),
});

export const crewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).refine(noMarkup, noMarkupMsg).optional(),
    maxMembers: z.number().int().min(2).max(30).optional(),
    totemName: z.string().trim().max(40).optional(),
    totemEmoji: z.string().trim().max(16).optional(),
    inviteLocked: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== undefined), {
    message: 'At least one field required',
  });

export const crewJoinSchema = z.object({
  inviteCode: z.string().trim().min(4).max(12),
});

// Public join-preview path param: same alphanumeric 4-12 shape the invite page enforces.
export const crewInviteCodeParams = z.object({
  inviteCode: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]{4,12}$/, 'Invalid invite code'),
});

// Reform a crew into a NEW crew in the target festival (M3). Crews are
// festival-scoped, so "reform" = create a new crew in `targetFestivalId` +
// invite the prior roster. `:crewId` (the source crew) comes from the path.
export const crewReformSchema = z.object({
  targetFestivalId: identifier,
});

export const crewTransferSchema = z.object({
  userId: identifier,
});

export const crewAddMemberSchema = z.object({
  userId: identifier,
});

export const meetingPointCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(100),
  location: z.string().trim().min(1, 'Location required').max(200),
  type: z.enum(MEETING_POINT_TYPES).default('during'),
  meetAt: z.string().datetime().optional().nullable(),
  stageReference: z.string().max(100).optional().nullable(),
  // F4: optional captured GPS coords (browser/native geolocation). Nullable —
  // legacy free-text points omit these and keep NULL coords server-side.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  // 055: optional daily recurrence — "regroup 3pm & 9pm at the tree" repeats each
  // festival day. Omitted ⇒ a one-shot point (recurs_daily defaults FALSE).
  recursDaily: z.boolean().optional(),
});

export const meetingPointUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    type: z.enum(MEETING_POINT_TYPES).optional(),
    meetAt: z.string().datetime().optional().nullable(),
    stageReference: z.string().max(100).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    // 055: toggle daily recurrence on an existing point.
    recursDaily: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== undefined), {
    message: 'At least one field required',
  });

// 090: "I'll be there" on a meeting point. The member sets only their own tap.
export const meetingPointComingSchema = z.object({ coming: z.boolean() });

// 090: the member's full set of day answers. A day left out is cleared; `days: []` clears all.
// The route rejects a dayIndex at or past the festival's day count. A repeated dayIndex: last wins.
export const crewDaysSchema = z
  .object({
    days: z
      .array(
        z.object({
          dayIndex: z.number().int().min(0).max(60),
          answer: z.enum(['going', 'maybe', 'no']),
        }),
      )
      .max(61),
  })
  // A repeated dayIndex keeps the last answer: a duplicate would collide on the primary key.
  .transform((body) => ({ days: [...new Map(body.days.map((d) => [d.dayIndex, d])).values()] }));
