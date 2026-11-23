// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { identifier } from './primitives';

// ── Poll Schemas ──────────────────────────────────────────────────
// A write whose fields are all optional must still name one, or a stale client's body
// (unknown keys are stripped) would silently clear the stored value. null still clears.
const hasDefinedField = (d: object) => Object.values(d).some((v) => v !== undefined);
const AT_LEAST_ONE_FIELD = { message: 'At least one field required' };

export const crewHomeBaseSchema = z
  .object({
    location: z.string().trim().max(200).optional().nullable(),
    time: z.string().trim().max(100).optional().nullable(),
    // T54: undefined keeps the stored Plan B; null or '' clears it.
    planB: z.string().trim().max(140).optional().nullable(),
  })
  .refine(hasDefinedField, AT_LEAST_ONE_FIELD);

// M6 Crew Photo Wall (Phase 1, link-out only). A single shared-album URL per
// crew (e.g. Google Photos / Apple shared album). https-only and length-bounded
// to avoid javascript:/data: schemes and oversized values; nullable / empty so
// a member can clear the link. Festie hosts no photos yet — this is a link-out.
export const crewPhotoAlbumSchema = z
  .object({
    photoAlbumUrl: z
      .string()
      .trim()
      .url('Must be a valid URL')
      .max(2048)
      .refine((u) => u.startsWith('https://'), 'Must be an https URL')
      .nullable()
      .optional()
      .or(z.literal('')),
  })
  .refine(hasDefinedField, AT_LEAST_ONE_FIELD);

// A schedule poll's set link for one option. The server stores these
// index-aligned with `options` and makes the winner a meeting point on close.
const pollSetRefSchema = z
  .object({
    setId: z.string().trim().min(1).max(100),
    // Mirrors the option text (max 200); the close route trims it to the meeting-point label limit.
    label: z.string().trim().min(1).max(200),
    stageReference: z.string().trim().max(100).nullable(),
    meetAt: z.string().datetime().nullable(),
  })
  .strip();

export const pollCreateSchema = z
  .object({
    question: z.string().trim().min(1, 'Question required').max(500),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
    closesAt: z.string().datetime().optional().nullable(),
    setRefs: z.array(pollSetRefSchema.nullable()).max(4).optional(),
    multiAnswer: z.boolean().optional(),
  })
  .refine((d) => d.setRefs === undefined || d.setRefs.length === d.options.length, {
    message: 'setRefs must match options',
    path: ['setRefs'],
  });

// Exactly one field: optionIndex (old clients) or optionIndexes (an empty array takes the vote back).
export const pollVoteSchema = z
  .object({
    optionIndex: z.number().int().min(0).max(3).optional(),
    optionIndexes: z.array(z.number().int().min(0).max(3)).max(4).optional(),
  })
  .refine((b) => (b.optionIndex === undefined) !== (b.optionIndexes === undefined), {
    message: 'Send optionIndex or optionIndexes',
    path: ['optionIndexes'],
  });

// ── Crew packing-board schemas (M2 logistics) ───────────────────────
export const packingCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(200),
  broughtBy: z.string().trim().max(100).optional().nullable(),
  claimed: z.boolean().optional(),
});

export const packingUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    broughtBy: z.string().trim().max(100).optional().nullable(),
    claimed: z.boolean().optional(),
    packed: z.boolean().optional(),
  })
  .refine(hasDefinedField, AT_LEAST_ONE_FIELD);

export const packingBatchSchema = z.object({
  labels: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
});

// ── Crew member status schema (M5: on-my-way / ETA) ─────────────────
// A last-synced, degraded-sync snapshot the member set (often offline) — NOT
// live GPS. All fields optional/nullable so a member can post just a status,
// just an ETA, or clear it. `status` is a small enum: 'on-my-way' | 'here' |
// 'delayed' | 'at-camp' | 'at-stage' | 'break' | 'lost' | null (clear).
// 'at-stage' stores the stage name in `note`. The list must match
// `CrewStatusKey` in packages/shared/src/types/domain.ts. etaMinutes is bounded (0–1440 = up to a day).
// 055: optional last-known LOCATION breadcrumb the member captured (often
// OFFLINE) and that delivers on the next signal blip. NOT live GPS — the UI
// renders it with honest staleness ("last seen near X, as of N ago"). lat/lng
// are finite + hard-bounded; capturedAt is the ISO time the device stamped the
// fix offline (the route defaults it to now() when a position arrives without
// one). `.strip()` drops unknown keys a client tacks on.
const crewStatusPosition = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    capturedAt: z.string().datetime().optional(),
  })
  .strip();

export const crewStatusSchema = z
  .object({
    status: z.enum(['on-my-way', 'here', 'delayed', 'at-camp', 'at-stage', 'break', 'lost']).optional().nullable(),
    targetMeetingPointId: z.string().trim().max(100).optional().nullable(),
    etaMinutes: z.number().int().min(0).max(1440).optional().nullable(),
    note: z.string().trim().max(280).optional().nullable(),
    position: crewStatusPosition.optional().nullable(),
    // Device time the status was set (often offline). The store clamps it to [now-24h, now].
    capturedAt: z.string().datetime().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

// ── Live Location + SOS schemas (ephemeral GPS relay + safety SOS) ──
// Live location is EPHEMERAL: it travels only over Socket.IO to the crew room
// and is NEVER written to Postgres. These schemas validate the socket payloads
// (locationShare/locationUpdate) and the durable SOS HTTP bodies (sosRaise/
// sosClear). Lat/lng are hard-bounded; capturedAt is an ISO timestamp the client
// stamps at fix time so the UI can render honest "live · N ago" staleness.

// A captured GPS coordinate. `.strip()` drops any unknown keys a client tacks on.
const liveCoord = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).optional(),
    heading: z.number().min(0).max(360).optional(),
    // Phase 4C: device battery % (0–100) of the SHARER, surfaced on the peer
    // popup ("8% — regroup"). OPTIONAL + backward-compatible: only populated when
    // a native build adds expo-battery (mobile) or the Battery API is present
    // (web); absent payloads behave exactly as before.
    battery: z.number().min(0).max(100).optional(),
    // Peer low-power flag (#5): the SHARER's device is in battery-saver / low-power
    // mode, surfaced next to battery on the peer popup. OPTIONAL + backward-compatible:
    // only populated when the native build reads it (expo-battery); absent → omitted.
    lowPower: z.boolean().optional(),
    capturedAt: z.string().datetime(),
  })
  .strip();

export const locationShareSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    crewId: z.string().min(1).max(100),
    // Optional first fix sent alongside the share-intent so peers see the sharer
    // immediately instead of waiting for the first periodic update tick.
    position: liveCoord.optional(),
    // Phase 4C: ISO timestamp this time-boxed share auto-stops, so peers can show
    // "sharing ends in Nm". OPTIONAL + backward-compatible.
    expiresAt: z.string().datetime().optional(),
  })
  .strip();

export const locationUpdateSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    crewId: z.string().min(1).max(100),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).optional(),
    heading: z.number().min(0).max(360).optional(),
    speed: z.number().min(0).max(1000).optional(),
    // Phase 4C (all OPTIONAL + backward-compatible): sharer battery % and the ISO
    // expiry of this time-boxed share, relayed so peers render battery + a
    // "sharing ends in Nm" countdown without any new endpoint.
    battery: z.number().min(0).max(100).optional(),
    // Peer low-power flag (#5): the SHARER's device is in battery-saver / low-power
    // mode. OPTIONAL + backward-compatible — absent payloads behave exactly as before.
    lowPower: z.boolean().optional(),
    expiresAt: z.string().datetime().optional(),
    capturedAt: z.string().datetime(),
  })
  .strip();

export const locationStopSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    crewId: z.string().min(1).max(100),
  })
  .strip();

// T41: one background fix posted over HTTP (POST /crews/:crewId/live-location),
// because a locked phone has no socket. crewId comes from the path. expiresAt is
// required so the server can enforce the share's time box.
export const liveLocationFixSchema = liveCoord
  .extend({
    speed: z.number().min(0).max(1000).optional(),
    expiresAt: z.string().datetime(),
  })
  .strip();

// Late-joiner snapshot request (Redis-backed); handled by location:sync in routes/socket.ts.
export const locationSyncSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    crewId: z.string().min(1).max(100),
  })
  .strip();

// SOS raise: a member presses SOS. `message` is a short capped note; `position`
// is the SINGLE intentional exception to ephemerality — it may be attached to
// the durable crew_activity row + push so the crew can actually find them.
const sosPositionSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).optional(),
    capturedAt: z.string().datetime(),
  })
  .strip();
export const sosRaiseSchema = z
  .object({
    message: z.string().trim().max(280).optional(),
    position: sosPositionSchema.optional(),
  })
  .strip();

// SOS clear: the raiser ("I'm safe") or any crew member dismisses an SOS. The
// actor is req.user; the crew is the path param; `raiserId` names whose SOS to
// clear and defaults to the caller.
export const sosClearSchema = z.object({ raiserId: z.string().trim().min(1).max(64).optional() }).strip();

// SOS seen: a member acks that they saw `raiserId`'s active SOS.
export const sosSeenSchema = z.object({ raiserId: z.string().trim().min(1).max(64) }).strip();

// Check-in timer: if the member does not tap "I'm OK" within `minutes`, the crew
// gets an SOS. `position` is the same coarse one-shot fix an SOS may carry.
export const checkinStartSchema = z
  .object({
    minutes: z.number().int().min(10).max(240),
    position: sosPositionSchema.optional(),
  })
  .strip();

// ── Crew carpool / ride-board schemas (M2 logistics) ────────────────
export const rideCreateSchema = z
  .object({
    driver: z.string().trim().max(100).optional().nullable(),
    seats: z.number().int().min(0).max(99).optional().nullable(),
    departFrom: z.string().trim().max(200).optional().nullable(),
    departAt: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
    direction: z.enum(['to_festival', 'home']).optional().nullable(),
    departTime: z.string().datetime().optional().nullable(),
  })
  .refine(hasDefinedField, AT_LEAST_ONE_FIELD);

export const rideUpdateSchema = z
  .object({
    driver: z.string().trim().max(100).optional().nullable(),
    seats: z.number().int().min(0).max(99).optional().nullable(),
    departFrom: z.string().trim().max(200).optional().nullable(),
    departAt: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
    direction: z.enum(['to_festival', 'home']).optional().nullable(),
    departTime: z.string().datetime().optional().nullable(),
  })
  .refine(hasDefinedField, AT_LEAST_ONE_FIELD);

// ── Refresh Token schema ────────────────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── Rating schemas ──────────────────────────────────────────────
export const ratingCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
});

// null clears the mark (back to unknown).
export const caughtUpdateSchema = z.object({
  caught: z.boolean().nullable(),
});

// crewId picks which of the requester's crews the wrap reports on.
export const wrapQuery = z.object({
  crewId: identifier.optional(),
});
