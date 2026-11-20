// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Zod Validation Schemas for All API Endpoints
 *
 * Usage:
 *   const validation = schemas.registerSchema.safeParse(req.body);
 *   if (!validation.success) return sendError(res, 400, validation.error.message);
 *
 * Coverage:
 *   - Authentication (register, login, password change, admin)
 *   - Profiles (picks, notes, reminders, live status)
 *   - Notifications (push tokens, preferences, marks)
 *   - Festivals (creation via routes/festivals.js)
 *   - Socket events (validated in routes/socket.js)
 *   - Crews (create, update, join, transfer operations)
 *
 * Validation flow: Express route → schema.safeParse() → sendError() or processData()
 *
 * NOTE: Inline validation in routes (checks for length, type, range) should use
 * schema validation instead. Patterns to consolidate in future:
 *   • Array.isArray() + length checks → zod.array()
 *   • String length checks → z.string().min().max()
 *   • Regex patterns → z.string().regex()
 *   • Numeric bounds → z.number().min().max()
 * This keeps validation rules centralized and ensures consistency.
 */

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_PUBLIC_PAGE_SIZE } from './pagination';
import {
  PICK_PRIORITY_VALUES,
  REMINDER_MINUTE_VALUES,
  ALLOWED_LINK_PLATFORMS,
  MAX_ARTISTS_PER_SET,
  MEETING_POINT_TYPES,
  ALLOWED_PICK_PRIORITIES,
  ALLOWED_REMINDER_MINUTES,
} from './constants';
import { sanitizeLinkRecord, sanitizeString, normalizeRecordKey, sanitizeIdentifier, validateTime, validateColor } from './helpers';
import { sendError, ErrorCodes } from './response';
import { normalizeLineup, todayInZone } from './lineup';
import type { AppConfig } from './config';

export { sanitizeLinkRecord };

// ════════════════════════════════════════════════════════════════════════════════
// Reusable Primitives
// ════════════════════════════════════════════════════════════════════════════════

const username = z.string().trim().min(1).max(40);
const password = z.string().min(8).max(200);
const identifier = z.string().min(1).max(100);
const shortText = z.string().max(1000);

// ════════════════════════════════════════════════════════════════════════════════
// Authentication Schemas
// ════════════════════════════════════════════════════════════════════════════════
// Password resets need an address, so sign-up requires one (FND-023).
const requiredEmail = z.string().trim().min(1, 'Email is required').email('Invalid email address').max(254);

/** True if `iso` (YYYY-MM-DD) is a date at least `years` years before today. */
function isAtLeastYearsOld(iso: string, years: number): boolean {
  const dob = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const threshold = new Date(Date.UTC(dob.getUTCFullYear() + years, dob.getUTCMonth(), dob.getUTCDate()));
  return threshold.getTime() <= Date.now();
}

// Anonymous sign-up source from a ?ref= link. Lower-cased; anything that does
// not match the pattern is dropped rather than failing the sign-up.
const SIGNUP_REF_PATTERN = /^[a-z0-9_-]{1,40}$/;
const signupRef = z.string().trim().toLowerCase().regex(SIGNUP_REF_PATTERN).optional().catch(undefined);

const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date of birth');
const tosAccepted = z.literal(true, { error: 'You must accept the Terms of Service' });
const adultRule = {
  message: 'You must be at least 18 to use Festie',
  path: ['dateOfBirth'],
};

export const registerSchema = z
  .object({
    username,
    password,
    confirmPassword: z.string(),
    email: requiredEmail,
    dateOfBirth,
    tosAccepted,
    ref: signupRef,
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => isAtLeastYearsOld(d.dateOfBirth, 18), adultRule);

// ── Sign in with Google and Apple (T45) ──
const providerName = z.enum(['google', 'apple']);
const idToken = z.string().min(20).max(4096);
const oauthNonce = z.string().min(16).max(128).optional();
const authorizationCode = z.string().max(512).optional(); // Apple only

const oauthProviderParams = z.object({ provider: providerName });

const oauthSignInSchema = z.object({
  idToken,
  nonce: oauthNonce,
  authorizationCode,
  redirectUri: z.string().url().max(300).optional(), // Apple web code exchange
  // Apple sends the name once, so markup is stripped in the route instead of rejected here.
  name: z
    .object({
      givenName: z.string().max(50).optional(),
      familyName: z.string().max(50).optional(),
    })
    .optional(),
});

// /register minus the password: the provider is the sign-in method.
const oauthCompleteSchema = z
  .object({
    signupToken: z.string().min(20).max(128),
    username,
    dateOfBirth,
    tosAccepted,
    ref: signupRef,
  })
  .refine((d) => isAtLeastYearsOld(d.dateOfBirth, 18), adultRule);

const setPasswordSchema = z
  .object({ newPassword: password, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username or email required').max(254),
  password: z.string().min(1, 'Password required').max(200),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

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

const profileUpdateSchema = z
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

const joinFestivalSchema = z.object({
  festivalId: identifier,
});

// ════════════════════════════════════════════════════════════════════════════════
// Admin Schemas
// ════════════════════════════════════════════════════════════════════════════════

const resetPasswordSchema = z.object({
  newPassword: password,
});

const resetPasswordPublicSchema = z.object({
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Invalid token')
    .max(64),
  newPassword: password,
  confirmPassword: z.string().min(8).max(100),
});

// ════════════════════════════════════════════════════════════════════════════════
// Notification & Push Schemas
// ════════════════════════════════════════════════════════════════════════════════
// Throws RangeError for an unknown IANA zone, which Intl reports for a bad id.
function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const dndTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)')
  .nullable();
const notificationPrefsSchema = z
  .object({
    crewUpdates: z.boolean().optional(),
    setReminders: z.boolean().optional(),
    scheduleChanges: z.boolean().optional(),
    lineupDrops: z.boolean().optional(),
    crewReformed: z.boolean().optional(),
    wrapReady: z.boolean().optional(),
    crewMeetingPoints: z.boolean().optional(),
    crewPolls: z.boolean().optional(),
    crewMoney: z.boolean().optional(),
    crewRides: z.boolean().optional(),
    crewNudges: z.boolean().optional(),
    mustSeeReminderMinutes: z
      .union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)])
      .nullable()
      .optional(),
    dndStart: dndTime.optional(),
    dndEnd: dndTime.optional(),
    dndTimeZone: z.string().max(64).refine(isIanaTimeZone, { message: 'Invalid IANA time zone' }).nullable().optional(),
  })
  .strict();

export const pushTokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
  deviceName: z.string().max(60).optional().nullable(),
  localRemindersFestivalId: z.string().min(1).max(128).nullable().optional(),
  localRemindersCoversUntil: z.number().int().nonnegative().max(8.64e15).nullable().optional(),
});

// ── Additional notification schemas ──────────────────────────────
const deleteTokenSchema = z.object({
  token: z.string().min(1, 'Token required').max(4096),
});

const markReadSchema = z.object({
  festivalId: z.string().max(100).optional(),
});

// ── Topic subscription schema ────────────────────────────────────
const topicSubscriptionSchema = z
  .record(z.string(), z.boolean())
  .refine((d) => Object.keys(d).length > 0 && Object.keys(d).length <= 10, {
    message: 'At least one topic required, max 10',
  });

// ── Account schemas ───────────────────────────────────────────────
const usernameChangeSchema = z.object({
  username: z.string().trim().min(1, 'Username required').max(40),
});

// Names reach push and email templates as well as escaped pages, so refuse markup at the door.
const noMarkup = (s: string) => !/[<>]/.test(s);
const noMarkupMsg = 'Names cannot contain < or >';

// Editable display name (friendly name). Username stays the immutable @handle.
export const displayNameChangeSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name required').max(50).refine(noMarkup, noMarkupMsg),
});

// Payment handles for settle-up deep links. All optional; an explicit empty
// string clears the handle (stored as NULL). Handles are short identifiers, not
// URLs — the deep-link builders prepend the scheme/host. A leading '@' or '$'
// is tolerated and normalized server-side.
const paymentHandle = z.string().trim().max(64).optional();
export const paymentHandlesSchema = z
  .object({
    venmoHandle: paymentHandle,
    cashappCashtag: paymentHandle,
    paypalHandle: paymentHandle,
  })
  .refine((v) => v.venmoHandle !== undefined || v.cashappCashtag !== undefined || v.paypalHandle !== undefined, {
    message: 'At least one payment handle is required',
  });

// Opt-in switch for the public /u/:username share page.
export const publicScheduleSchema = z.object({
  publicSchedule: z.boolean(),
});

export const accountDeleteSchema = z.object({
  // Optional: a provider-only account has no password and confirms with a recent re-auth.
  password: z.string().min(1, 'Password confirmation required').optional(),
  // Who takes over each crew the account owns. Optional: the server picks the
  // earliest-joined active member when a choice is missing or invalid.
  crewHandover: z.array(z.object({ crewId: identifier, newOwnerId: identifier })).max(50).optional(),
});

// A password, or a fresh token from a linked Google or Apple account.
const reauthSchema = z.union([
  z.object({ password: z.string().min(1).max(200) }),
  z.object({ provider: providerName, idToken, nonce: oauthNonce, authorizationCode }),
]);

const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email required').max(254),
});

export const updateEmailSchema = z.object({
  email: z.string().email('Valid email required').max(254),
  // Optional: a provider-only account has no password and confirms with a recent re-auth.
  password: z.string().min(1, 'Password confirmation required').optional(),
});

// ── Festival schemas (admin) ───────────────────────────────────────
const stageSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(100),
  // The shape is checked by validateFestivalIssues, which names the stage at fault.
  color: z.string().max(20).optional(),
  // Festival-map: optional GPS pin for this stage (mirrors meetingPointCreateSchema
  // coords). Nullable — stages without coords simply don't render a map pin and the
  // "not mapped yet" fallback stays for festivals that were never mapped.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

// An unknown platform key is dropped, not rejected, so a save that carries a newer key still works.
const KNOWN_LINK_PLATFORMS = new Set<string>(ALLOWED_LINK_PLATFORMS);

const artistLinkSchema = z.object({
  // The artists row this element copies. The server decides what it means (resolveArtistRefs).
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(300),
  links: z
    .record(z.string().max(40), z.string().url().max(500).or(z.literal('')).optional().nullable())
    .optional()
    .default({} as Record<string, string | null | undefined>)
    .transform((obj) =>
      Object.fromEntries(
        Object.entries(obj || {}).filter(([k, v]) => KNOWN_LINK_PLATFORMS.has(k) && v != null && v !== ''),
      ),
    ),
});

const setSchema = z
  .object({
    id: z.string().max(100).optional(),
    // An empty list or no artist at all is reported by validateFestivalIssues, which names the set.
    artists: z.array(artistLinkSchema).max(MAX_ARTISTS_PER_SET).optional(),
    // Backward compat — old clients may still send artist/linkUrl
    artist: z.string().max(300).optional(),
    // Billed name for the whole set. Absent keeps the stored name; null or '' clears it.
    displayName: z.string().max(300).optional().nullable(),
    stageId: z.string().max(100).optional().nullable(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .nullable()
      .or(z.literal('')),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .nullable()
      .or(z.literal('')),
    linkUrl: z.string().max(500).optional().nullable().or(z.literal('')),
  });

const daySchema = z.object({
  label: z.string().max(100).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sets: z.array(setSchema).optional(),
});

// One billing line of the announced lineup (festivals.lineup). The server owns announcedAt and
// makes the id when it is absent; status defaults to announced (see lib/lineup.ts normalizeLineup).
const lineupEntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  artists: z.array(artistLinkSchema).min(1).max(MAX_ARTISTS_PER_SET),
  displayName: z.string().max(300).optional().nullable(),
  tier: z.number().int().min(1).max(9).optional().nullable(),
  dayDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  status: z.enum(['announced', 'cancelled']).optional(),
  announcedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  linkedSetIds: z.array(z.string().max(100)).max(10).optional(),
});

// Optional IANA time-zone id (e.g. `America/New_York`). Anchors set status +
// reminder fire-times in the festival's zone. Validated by attempting to
// construct an Intl.DateTimeFormat with it — a RangeError means an unknown zone.
// Allow null/undefined so existing festivals (and the update path) can omit it.
const festivalTimeZone = z
  .string()
  .max(64)
  .refine(isIanaTimeZone, { message: 'Invalid IANA time zone' })
  .nullable()
  .optional();

// ── Festival map config (site-plan overlay, amenities, zones) ───────────
// All coordinates are GeoJSON order: [longitude, latitude]. Every sub-field is
// optional and the object is .strict() so unknown keys are rejected; the whole
// map_config column is nullable so existing festivals (no map data) keep working
// and the "not mapped yet" fallback stays. Bounds are clamp/structure-only (we
// don't enforce west<east etc.) so partial editing in an admin UI stays ergonomic.

const AMENITY_TYPES = ['water', 'medical', 'toilet', 'food', 'atm', 'entrance', 'exit', 'info', 'charging'] as const;

// [lng, lat] tuple with lng in -180..180 and lat in -90..90.
const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const amenityFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    geometry: z
      .object({
        type: z.literal('Point'),
        coordinates: lngLat,
      })
      .strict(),
    properties: z
      .object({
        id: z.string().max(100),
        amenityType: z.enum(AMENITY_TYPES),
        label: z.string().max(200),
      })
      .strict(),
  })
  .strict();

const amenitiesCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(amenityFeatureSchema).max(500),
  })
  .strict();

const zoneFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    geometry: z
      .object({
        type: z.literal('Polygon'),
        // Polygon = array of linear rings, each ring an array of [lng, lat] positions.
        coordinates: z.array(z.array(lngLat).max(1000)).max(50),
      })
      .strict(),
    properties: z.record(z.string(), z.any()).optional(),
  })
  .strict();

const zonesCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(zoneFeatureSchema).max(200),
  })
  .strict();

const siteplanSchema = z
  .object({
    // https-only to avoid javascript:/data: schemes (mirrors crewPhotoAlbumSchema).
    imageUrl: z.string().url().max(2048).startsWith('https://', 'Image URL must be https'),
    // Exactly 4 georeferencing corners, each [lng, lat] (TL, TR, BR, BL by convention).
    corners: z.tuple([lngLat, lngLat, lngLat, lngLat]),
    opacity: z.number().min(0).max(1),
  })
  .strict();

// Offline VECTOR basemap (Phase 3A). When present, the client renders a PMTiles
// vector basemap (pmtiles:// protocol) instead of the online OSM raster, so a
// downloaded/CDN-hosted `.pmtiles` archive can back the map with little/no
// network. ADDITIVE: absent ⇒ the map keeps the online OSM raster (graceful
// fallback). https-only (mirrors siteplan.imageUrl / crewPhotoAlbumSchema) to
// avoid javascript:/data: schemes; the client also re-asserts https + an exact
// host allowlist before the WebView ever loads it.
const offlineBasemapSchema = z
  .object({
    pmtilesUrl: z.string().url().max(2048).startsWith('https://', 'PMTiles URL must be https'),
    attribution: z.string().max(500).optional(),
  })
  .strict();

export const festivalMapConfigSchema = z
  .object({
    version: z.literal(1),
    center: lngLat.optional(),
    // [[west, south], [east, north]] — SW corner then NE corner, each [lng, lat].
    bounds: z.tuple([lngLat, lngLat]).optional(),
    amenities: amenitiesCollectionSchema.optional(),
    zones: zonesCollectionSchema.optional(),
    siteplan: siteplanSchema.optional(),
    offlineBasemap: offlineBasemapSchema.optional(),
  })
  .strict();

const festivalCreateSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  location: z.string().max(500).optional(),
  b2bSeparator: z.string().max(10).optional(),
  timeZone: festivalTimeZone,
  stages: z.array(stageSchema).max(20).optional(),
  days: z.array(daySchema).max(10).optional(),
  // The announced lineup, at most 500 lines. A save that omits it keeps the stored list.
  lineup: z.array(lineupEntrySchema).max(500).optional(),
  // Venue point the map and weather use. Sent only when the admin changes it.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  // Optional festival site-map. Nullable so an update can clear it; omitted on
  // legacy clients ⇒ map_config stays NULL and the festival renders unmapped.
  mapConfig: festivalMapConfigSchema.optional().nullable(),
  // Links editions of one recurring festival. Null clears it; omitted keeps the stored value.
  seriesId: z
    .string()
    .regex(/^[a-z0-9-]{1,60}$/, 'Use lower-case letters, digits and hyphens, up to 60 characters.')
    .nullable()
    .optional(),
});

const festivalUpdateSchema = festivalCreateSchema
  .extend({
    // A save that drops sets carrying picks or ratings is refused with
    // CONFIRM_REMOVALS unless this is true (and the session re-authenticated).
    confirmRemovals: z.boolean().optional(),
    // The festival's updatedAt when the editor loaded it. A mismatch returns
    // FESTIVAL_CHANGED so a stale form cannot overwrite a newer save.
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .partial()
  // false saves without pushing schedule alerts to people whose picks changed.
  .extend({ notify: z.boolean().optional() })
  .refine((d) => Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== undefined), 'At least one field required')
  // The PUT also rewrites name, stages and map from the body, so a lineup save from a stale copy needs the token.
  .refine((d) => d.lineup === undefined || d.expectedUpdatedAt !== undefined, {
    message: 'Saving the lineup needs expectedUpdatedAt, the updatedAt you loaded.',
    path: ['expectedUpdatedAt'],
  });

// ── Lineup import (admin) ───────────────────────────────────────────
// A field that is absent means "column not mapped, leave alone". An empty string means "clear".
const lineupImportRowSchema = z
  .object({
    row: z.number().int().min(1).max(100_000), // 1-based line number in the source file
    setId: z.string().max(100).optional(), // a re-imported export matches by id first
    artist: z.string().max(300),
    day: z.string().max(100).optional(),
    date: z.string().max(20).optional(),
    stage: z.string().max(100).optional(),
    startTime: z.string().max(20).optional(),
    endTime: z.string().max(20).optional(),
    stageColor: z.string().max(20).optional(),
    // The single link column names no platform: the server reads it from the host.
    link: z.string().max(500).optional(),
    // One artist id per name, separated by "|" for a B2B set. An empty position leaves that name to the matcher.
    artistId: z.string().max(450).optional(),
    // Billed name for the set (new sets) or the announced entry. An empty string clears it.
    displayName: z.string().max(300).optional(),
    spotify: z.string().max(500).optional(),
    soundcloud: z.string().max(500).optional(),
    instagram: z.string().max(500).optional(),
    twitter: z.string().max(500).optional(),
    tiktok: z.string().max(500).optional(),
    facebook: z.string().max(500).optional(),
    website: z.string().max(500).optional(),
  })
  .strict();
export type LineupImportRowInput = z.infer<typeof lineupImportRowSchema>;

export const lineupImportRequestSchema = z
  .object({
    rows: z.array(lineupImportRowSchema).min(1).max(500),
    updateExisting: z.boolean().default(false),
    createMissing: z.boolean().default(true),
    skipSpotify: z.boolean().default(false),
    // On: a row with a set_id and another day moves that set. Off: such a row is skipped.
    moveDays: z.boolean().default(false),
  })
  .strict();

// ── Festival announcements (admin) ──────────────────────────────────
// Title 80 and body 200 keep the push inside payload.ts MAX_TITLE_LENGTH and MAX_BODY_LENGTH.
export const festivalAnnouncementSchema = z
  .object({
    severity: z.enum(['info', 'urgent']),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(200),
    screen: z.enum(['home', 'map', 'timeline', 'picks', 'festival-mode', 'crew']).default('home'),
    sendAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// ── Set-time releases (admin) ───────────────────────────────────────
// One alert per festival date. note is the push body, so it stays inside payload.ts MAX_BODY_LENGTH (200).
// confirmPartial lets a date go out while some of its sets still have no time.
export const timeReleaseSendSchema = z
  .object({
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(10),
    note: z.string().trim().min(1).max(200).optional(),
    confirmPartial: z.boolean().optional(),
  })
  .strict();

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

const crewJoinSchema = z.object({
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
const crewReformSchema = z.object({
  targetFestivalId: identifier,
});

const crewTransferSchema = z.object({
  userId: identifier,
});

const crewAddMemberSchema = z.object({
  userId: identifier,
});

// ── Set link schema (admin) ──────────────────────────────────────
// https-only to avoid javascript:/data: schemes (mirrors crewPhotoAlbumSchema).
const setLinkSchema = z.object({
  linkUrl: z
    .string()
    .url('Must be a valid URL')
    .max(500)
    .refine((u) => u.startsWith('https://'), 'Must be an https URL')
    .nullable()
    .optional()
    .or(z.literal('')),
  // Which artist of a B2B set the link belongs to (default 0).
  artistIndex: z.number().int().min(0).max(3).optional(),
});

// ── Artist schemas (admin) ───────────────────────────────────────
// The artist routes check links with lib/artist-links.ts, so a raw link is only length-bounded here.
const artistMatchSchema = z.object({
  items: z
    .array(z.object({ name: z.string().max(300), spotify: z.string().max(500).nullable().optional() }))
    .min(1)
    .max(500),
});

const artistCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  // The note that tells same-name artists apart. Required when another artist has the name.
  label: z.string().max(200).optional(),
  link: z.string().max(500).optional(),
});

const artistUpdateSchema = z.object({
  // The artist's updatedAt the editor loaded (millisecond precision).
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  changes: z
    .object({
      name: z.string().max(300).optional(),
      label: z.string().max(200).optional(),
      addLink: z.string().max(500).optional(),
      removeLinks: z.array(z.string().max(40)).max(12).optional(),
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined), 'At least one change required'),
});

const artistListQuerySchema = z.object({
  festivalId: z.string().max(100).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  // "Possible duplicates": artists with the same name key or a key one character apart, on any festival.
  duplicates: z.enum(['true']).optional(),
});

// Merge the artist in the path (the survivor) with `loserId`. Admin only, web only, behind a recent re-auth.
const mergeSide = z.enum(['survivor', 'loser']);
const artistMergeSchema = z.object({
  loserId: identifier,
  // Each artist's updatedAt the editor loaded (millisecond precision).
  survivorUpdatedAt: z.string().datetime({ offset: true }),
  loserUpdatedAt: z.string().datetime({ offset: true }),
  // How many festivals, archived ones included, the editor saw in the preview. The server counts again under its locks and refuses a higher count.
  acceptedFestivals: z.number().int().min(0).max(10_000),
  // Per field, which artist's value the merged artist keeps. A field left out keeps the survivor's.
  pick: z
    .object({
      name: mergeSide.optional(),
      label: mergeSide.optional(),
      photo: mergeSide.optional(),
      genres: mergeSide.optional(),
      links: z.record(z.string().max(40), mergeSide).refine((links) => Object.keys(links).length <= 12, 'Too many link choices').optional(),
    })
    .optional(),
});

// The artist id backfill. `run` needs a recent re-auth; the other two modes write nothing.
export const artistBackfillSchema = z.object({
  mode: z.enum(['dry-run', 'run', 'verify']),
  // The planHash of the reviewed dry run. `run` refuses with 409 PLAN_CHANGED when the plan it computes differs.
  planHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

// The policy-update notice email. `send` needs a recent re-auth; `dry-run` only counts recipients.
// noticeId keys the idempotency ledger, so one id is one notice. html is the admin's own markup; without it the mail is built from the escaped text.
export const policyNoticeSchema = z
  .object({
    noticeId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
    // No CR or LF: the subject becomes a mail header, so a line break would inject headers.
    subject: z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/),
    text: z.string().trim().min(1).max(20000),
    html: z.string().trim().min(1).max(100000).optional(),
    mode: z.enum(['dry-run', 'send']),
  })
  .strict();

// "Find Spotify links": the candidates for the artists on one festival, and the editor's picks.
const artistSpotifyCandidatesSchema = z.object({
  festivalId: identifier,
  // Artists the editor skipped or Spotify could not match. They leave the search so the next ones reach it.
  exclude: z.array(identifier).max(1000).optional(),
});

const artistSpotifyPicksSchema = z.object({
  festivalId: identifier,
  picks: z
    .array(
      z.object({
        artistId: identifier,
        // The artist's updatedAt the editor loaded (millisecond precision).
        expectedUpdatedAt: z.string().datetime({ offset: true }),
        // Spotify's 22-character artist id. The server builds the link and reads the photo and genres from Spotify.
        spotifyId: z.string().regex(/^[A-Za-z0-9]{22}$/, 'Not a Spotify artist id'),
        // How many other festivals the editor confirmed the artist is on. The server counts again under the locks and refuses a higher count.
        acceptedAlsoOn: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .min(1)
    .max(200),
});

// Spotify backfill body. All optional: old mobile bundles post no body.
export const spotifyBackfillSchema = z
  .object({
    // `force` is gone: a guess never overwrites a link. An old client that sends it is ignored (keys are stripped).
    skipSearch: z.boolean().optional(),
    // Artist name -> verified link, preferred over search.
    overrides: z
      .record(
        z.string().trim().min(1).max(200),
        // url() alone accepts javascript: and data: links.
        z
          .string()
          .url()
          .max(500)
          .refine((u) => u.startsWith('https://'), 'Must be an https URL'),
      )
      .refine((o) => Object.keys(o).length <= 500, 'At most 500 overrides')
      .optional(),
    // Limits the run to these sets.
    setIds: z.array(identifier).max(500).optional(),
  })
  .default({});

// ── Public beacon bodies (unauthenticated, rate-limited) ────────

export const installEventSchema = z.object({
  platform: z.enum(['ios', 'android', 'desktop'], { error: 'Invalid platform' }),
  event: z.enum(['shown', 'accepted', 'dismissed', 'native_fired', 'inapp_blocked'], { error: 'Invalid event' }),
  // Optional extras are dropped, not rejected, when malformed: the beacon is fire-and-forget.
  reason: z.string().optional().catch(undefined),
  engagement_ms: z.number().optional().catch(undefined),
});

export const clientPerfBeaconSchema = z.object({
  lcp: z.number(),
  fid: z.number(),
  cls: z.number().optional(),
  avgRenderMs: z.number().optional(),
  renders: z.number().optional(),
});

export const webVitalsBeaconSchema = z.object({
  name: z.string(),
  value: z.number(),
  rating: z.string().optional().catch(undefined),
  delta: z.number().optional().catch(undefined),
  id: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
  navigationType: z.string().optional().catch(undefined),
});

// ── Meeting Point schemas (Phase 1B) ────────────────────────────

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

// ── Validation middleware factory ───────────────────────────────────
/** The request members the factories read and write, so a bare double can stand in for a request. */
type ValidatedRequest = Pick<Partial<Request>, 'body' | 'query' | 'params' | 'validatedBody' | 'validatedQuery' | 'validatedParams'>;

/** One middleware for all three request sources, so the 400 shape stays in one place. */
function validateSource(source: 'body' | 'query' | 'params', target: 'validatedBody' | 'validatedQuery' | 'validatedParams', schema: z.ZodType) {
  return (req: ValidatedRequest, res: Partial<Response>, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const firstIssue = result.error.issues[0]!;
      const message =
        firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res as Response, 400, message, ErrorCodes.VALIDATION_ERROR, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req[target] = result.data;
    next();
  };
}

/** Parses req.body and stores the result in req.validatedBody. */
export const validate = (schema: z.ZodType) => validateSource('body', 'validatedBody', schema);

/** Parses req.query and stores the result in req.validatedQuery. */
export const validateQuery = (schema: z.ZodType) => validateSource('query', 'validatedQuery', schema);

/** Parses req.params and stores the result in req.validatedParams. */
export const validateParams = (schema: z.ZodType) => validateSource('params', 'validatedParams', schema);

// ════════════════════════════════════════════════════════════════════════════════
// Payload Normalizers (consolidated from lib/validation.js)
// ════════════════════════════════════════════════════════════════════════════════

const _MAX_ARTISTS = MAX_ARTISTS_PER_SET;

/** One artist element of a set or lineup entry, as a client sends it or a stored row holds it. */
interface ArtistPayload {
  id?: unknown;
  name?: unknown;
  links?: unknown;
  photo?: unknown;
  genres?: unknown;
}

/** An artist element after cleaning. Photo and genres are copied from the stored set only. */
interface SavedArtist {
  id?: string;
  name: string;
  links: Record<string, string>;
  photo?: string;
  genres?: string[];
}

/** A set as a client sends it. */
interface SetPayload {
  id?: string;
  artist?: string;
  artists?: ArtistPayload[];
  linkUrl?: unknown;
  displayName?: string | null;
  stageId?: string;
  startTime?: string | null;
  endTime?: string | null;
}

/** A set as the stored festival holds it. */
interface StoredSet {
  id?: string;
  artist?: string;
  artists?: ArtistPayload[];
  linkUrl?: unknown;
  displayName?: string | null;
}

interface StagePayload {
  id?: string;
  name?: string;
  color?: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface DayPayload {
  label?: string;
  date?: string;
  sets?: SetPayload[];
}

/** A festival as a client sends it, or as the festival cache holds it. */
interface FestivalPayload {
  id?: string;
  name?: string;
  location?: string;
  b2bSeparator?: string;
  timeZone?: string | null;
  mapConfig?: unknown;
  seriesId?: string | null;
  createdAt?: string;
  latitude?: number | null;
  longitude?: number | null;
  lineup?: unknown[];
  stages?: StagePayload[];
  days?: DayPayload[];
}

/**
 * Derive a display name from an artists array using the festival's b2b separator.
 * @param artists - Array of { name, links } objects
 * @param separator - B2B separator string (default: 'b2b')
 * @returns Display name like "DJ Alpha b2b DJ Beta"
 */
export function artistDisplayName(artists: { name?: unknown }[], separator = 'b2b'): string {
  if (!artists?.length) return 'Unknown';
  return artists.map((a) => a.name).join(` ${separator} `);
}

/**
 * Normalize a set's artist data — accepts both old (artist+linkUrl) and new (artists[]) formats.
 * Always returns a normalized artists array.
 */
// Returns any[]: tests index the result without an undefined check.
export function normalizeSetArtists(set: SetPayload): any[] {
  if (set.artists && set.artists.length > 0) {
    return set.artists
      .slice(0, _MAX_ARTISTS)
      .map((a) => ({
        ...artistIdOf(a),
        name: sanitizeString(a.name || '', 300),
        links: sanitizeLinkRecord(a.links),
      }))
      .filter((a) => a.name);
  }
  // Backward compat: convert old artist + linkUrl to artists[]
  const name = sanitizeString(set.artist || '', 300);
  if (!name) return [];
  const links: Record<string, string> = {};
  const rawUrl = set.linkUrl && typeof set.linkUrl === 'string' ? set.linkUrl.trim() : '';
  if (rawUrl && /^https?:\/\//.test(rawUrl)) links.spotify = rawUrl.slice(0, 500);
  return [{ name, links }];
}

/** The artists row id of an element, as `{ id }`, or nothing. Every writer keeps it. */
function artistIdOf(element: ArtistPayload | null | undefined): { id?: string } {
  const id = sanitizeIdentifier(element?.id, 100);
  return id ? { id } : {};
}

const _escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function _cleanArtistList(list: ArtistPayload[]): SavedArtist[] {
  return list
    .slice(0, _MAX_ARTISTS)
    .map((a) => ({ ...artistIdOf(a), name: sanitizeString(a?.name || '', 300), links: sanitizeLinkRecord(a?.links) }))
    .filter((a) => a.name);
}

function _findArtist<T extends ArtistPayload>(list: T[], name: string): T | undefined {
  const key = name.toLowerCase();
  return list.find((a) => typeof a?.name === 'string' && a.name.trim().toLowerCase() === key);
}

// photo and genres are server-owned (lineup import and the Spotify backfill
// write them); clients never send them, so they are copied from the stored set.
function _storedArtistExtras(stored: ArtistPayload | undefined): Pick<SavedArtist, 'photo' | 'genres'> {
  const extras: Pick<SavedArtist, 'photo' | 'genres'> = {};
  const photo = stored?.photo;
  if (typeof photo === 'string' && photo.length <= 500 && photo.startsWith('https://')) extras.photo = photo;
  if (Array.isArray(stored?.genres)) {
    const genres = stored.genres
      .filter((g: unknown) => typeof g === 'string')
      .map((g: string) => sanitizeString(g, 50))
      .filter(Boolean)
      .slice(0, 10);
    if (genres.length > 0) extras.genres = genres;
  }
  return extras;
}

// A client that edits only the flat linkUrl (mobile) shows spotify, then soundcloud, then the
// stored linkUrl. Apply the field only when it differs from that shown link.
function _applyLinkEdit(links: Record<string, string>, rawLinkUrl: unknown, storedLinkUrl: unknown): void {
  const shownKey = links.spotify ? 'spotify' : links.soundcloud ? 'soundcloud' : null;
  const shown = (shownKey ? links[shownKey] : typeof storedLinkUrl === 'string' ? storedLinkUrl.trim() : '') || '';
  const next = typeof rawLinkUrl === 'string' ? rawLinkUrl.trim().slice(0, 500) : '';
  if (next === shown) return;
  if (!next) {
    if (shownKey) delete links[shownKey];
  } else if (/^https?:\/\//.test(next)) {
    links.spotify = next;
  }
}

/**
 * Resolve a saved set's artists against the stored set with the same id, so an
 * update keeps per-artist links, photos and genres the client never sent.
 *  - No artists[] and the typed `artist` is unchanged: keep the stored artists,
 *    applying a changed `linkUrl` to the first artist.
 *  - artists[] whose display name matches the typed `artist`: use artists[]
 *    and its links only, so a removed link stays removed.
 *  - Otherwise the typed name wins: split it on ` ${sep} ` into one artist per
 *    name, copying links by name from artists[], then from the stored set.
 * normalizeSetArtists stays for the create path.
 */
/** A set's billed name: the sent value, or the stored one when the payload leaves it out. */
function resolveSetDisplayName(set: SetPayload, storedSet: StoredSet | undefined): string | null {
  if (set.displayName === undefined) return storedSet?.displayName || null;
  return sanitizeString(set.displayName || '', 300) || null;
}

export function resolveSetArtists(set: SetPayload, storedSet: StoredSet | undefined, sep = 'b2b'): any[] {
  const stored: ArtistPayload[] = Array.isArray(storedSet?.artists) ? storedSet.artists : [];
  const payload = Array.isArray(set.artists) ? _cleanArtistList(set.artists) : [];
  const typed = sanitizeString(set.artist || '', 300);

  let result: SavedArtist[];
  if (payload.length === 0 && stored.length > 0 && typed && typed === artistDisplayName(stored, sep)) {
    result = _cleanArtistList(stored);
    if (result[0] && 'linkUrl' in set) _applyLinkEdit(result[0].links, set.linkUrl, storedSet?.linkUrl);
  } else if (payload.length > 0 && (!typed || typed === artistDisplayName(payload, sep))) {
    result = payload;
  } else {
    if (!typed) return [];
    const names = typed
      .split(new RegExp(` ${_escapeRegExp(sep)} `, 'i'))
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, _MAX_ARTISTS);
    result = names.map((name) => ({
      name,
      links: { ...(_findArtist(payload, name)?.links ?? sanitizeLinkRecord(_findArtist(stored, name)?.links)) },
    }));
    const rawUrl = typeof set.linkUrl === 'string' ? set.linkUrl.trim() : '';
    if (result[0] && !result[0].links.spotify && /^https?:\/\//.test(rawUrl)) {
      result[0].links.spotify = rawUrl.slice(0, 500);
    }
  }
  // An element without an id takes the id of the sent or stored element with the same name.
  return result.map((a) => ({
    ...(a.id ? {} : artistIdOf(_findArtist(payload, a.name) ?? _findArtist(stored, a.name))),
    ...a,
    ..._storedArtistExtras(_findArtist(stored, a.name)),
  }));
}

export function normalizePickPayload(
  input: unknown,
  config: Pick<AppConfig, 'MAX_PICKS'>,
): { error?: string; value?: any } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid picks format' };
  }
  const entries = Object.entries(input);
  if (entries.length > config.MAX_PICKS) {
    return { error: 'Too many picks' };
  }
  const picks = Object.create(null);
  for (const [rawSetId, priority] of entries) {
    const setId = normalizeRecordKey(rawSetId, 100);
    if (!setId) return { error: 'Invalid pick key' };
    if (!ALLOWED_PICK_PRIORITIES.has(priority)) {
      return { error: `Invalid priority: ${priority}` };
    }
    picks[setId] = priority;
  }
  return { value: picks };
}

export function normalizeNotePayload(
  input: unknown,
  config: Pick<AppConfig, 'MAX_NOTES' | 'MAX_NOTE_LENGTH'>,
): { error?: string; value?: any } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid notes format' };
  }
  const entries = Object.entries(input);
  if (entries.length > config.MAX_NOTES) {
    return { error: 'Too many notes' };
  }
  const notes = Object.create(null);
  for (const [rawSetId, note] of entries) {
    const setId = normalizeRecordKey(rawSetId, 100);
    if (!setId) return { error: 'Invalid note key' };
    if (typeof note !== 'string') return { error: 'Note must be a string' };
    if (note.length > config.MAX_NOTE_LENGTH * 2) return { error: 'Note too long' };
    const sanitized = sanitizeString(note, config.MAX_NOTE_LENGTH);
    notes[setId] = sanitized;
  }
  return { value: notes };
}

export function normalizeReminderPayload(
  input: unknown,
  config: Pick<AppConfig, 'MAX_REMINDERS'>,
): { error?: string; value?: any } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid reminders format' };
  }
  const entries = Object.entries(input);
  if (entries.length > config.MAX_REMINDERS) {
    return { error: `Maximum ${config.MAX_REMINDERS} reminders per profile` };
  }
  const reminders = Object.create(null);
  for (const [rawSetId, leadMinutes] of entries) {
    const setId = normalizeRecordKey(rawSetId, 100);
    if (!setId) return { error: 'Invalid reminder key' };
    const minutes = Number.parseInt(leadMinutes as string, 10);
    if (!ALLOWED_REMINDER_MINUTES.has(minutes)) {
      return { error: 'Invalid reminder time' };
    }
    reminders[setId] = minutes;
  }
  return { value: reminders };
}

export function sanitizeFestivalPayload(
  input: FestivalPayload,
  existingFestival: FestivalPayload | null | undefined,
  config: Partial<Pick<AppConfig, 'MAX_STAGES' | 'MAX_DAYS' | 'MAX_SETS_PER_DAY'>>,
  createOpaqueId: (prefix: string) => string,
  // any: tests index the saved festival's days and sets without undefined checks.
): any {
  const now = new Date().toISOString();
  const b2bSep = sanitizeString(input.b2bSeparator ?? existingFestival?.b2bSeparator ?? 'b2b', 10) || 'b2b';
  // Time zone: already validated as a plausible IANA id by the Zod schema. An
  // explicit empty string clears it (→ null = device-local behavior). Undefined
  // keeps whatever the festival already had so updates don't drop it.
  const rawTz = input.timeZone !== undefined ? input.timeZone : existingFestival?.timeZone;
  const timeZone = rawTz ? sanitizeString(rawTz, 64) || null : null;
  // Coordinate accepted only when it is a finite number within range; anything
  // else (string, NaN, out-of-range) collapses to null so the DB stores a clean
  // nullable double. Stages without coords keep null and render no map pin.
  const coord = (value: unknown, max: number): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= -max && value <= max ? value : null;
  // map_config: already shape-validated by festivalMapConfigSchema on the way in.
  // An explicit null clears it; undefined keeps whatever the festival already had.
  const mapConfig =
    input.mapConfig !== undefined ? (input.mapConfig ?? null) : (existingFestival?.mapConfig ?? null);
  // Venue: neither sent keeps the stored point; a valid pair replaces it; anything else clears both.
  const venueSent = input.latitude !== undefined || input.longitude !== undefined;
  const venueLat = venueSent ? coord(input.latitude, 90) : (existingFestival?.latitude ?? null);
  const venueLng = venueSent ? coord(input.longitude, 180) : (existingFestival?.longitude ?? null);
  const venueValid = venueLat !== null && venueLng !== null;
  // series_id: shape-validated by festivalCreateSchema. Undefined keeps the stored value; null clears it.
  const seriesId = input.seriesId !== undefined ? (input.seriesId ?? null) : (existingFestival?.seriesId ?? null);
  const storedSets = new Map<string, SetPayload>();
  for (const day of existingFestival?.days || []) {
    for (const set of day?.sets || []) if (set?.id) storedSets.set(set.id, set);
  }
  return {
    id: existingFestival?.id || sanitizeIdentifier(input.id, 100) || createOpaqueId('fest'),
    name: sanitizeString(input.name || existingFestival?.name || ''),
    location: sanitizeString(input.location ?? existingFestival?.location ?? '', 500),
    b2bSeparator: b2bSep,
    timeZone,
    stages: (input.stages || existingFestival?.stages || [])
      .slice(0, config.MAX_STAGES)
      .map((stage, index) => ({
        id: sanitizeIdentifier(stage.id, 100) || createOpaqueId(`stage-${index}`),
        name: sanitizeString(stage.name || '', 100),
        color: validateColor(stage.color) ? stage.color : '#666666',
        latitude: coord(stage.latitude, 90),
        longitude: coord(stage.longitude, 180),
      })),
    days: (input.days || existingFestival?.days || []).slice(0, config.MAX_DAYS).map((day) => ({
      label: sanitizeString(day.label || '', 100),
      date: sanitizeString(day.date || '', 20),
      sets: (day.sets || []).slice(0, config.MAX_SETS_PER_DAY).map((set, index) => {
        const setId = sanitizeIdentifier(set.id, 100);
        const artists = existingFestival
          ? resolveSetArtists(set, setId ? storedSets.get(setId) : undefined, b2bSep)
          : normalizeSetArtists(set);
        return {
          id: setId || createOpaqueId(`set-${index}`),
          artists,
          // Phase 1 backward compat: keep flat artist + linkUrl for rollback safety
          artist: artistDisplayName(artists, b2bSep),
          displayName: resolveSetDisplayName(set, setId ? storedSets.get(setId) : undefined),
          stageId: sanitizeIdentifier(set.stageId, 100) || '',
          startTime: validateTime(set.startTime) ? set.startTime : null,
          endTime: validateTime(set.endTime) ? set.endTime : null,
          linkUrl: artists[0]?.links?.spotify || null,
        };
      }),
    })),
    mapConfig,
    seriesId,
    // Sent: cleaned and keyed against the stored list. Omitted: the stored list stays.
    lineup:
      input.lineup !== undefined
        ? normalizeLineup(input.lineup, existingFestival?.lineup ?? [], {
            createId: createOpaqueId,
            today: todayInZone(timeZone),
          })
        : (existingFestival?.lineup ?? []),
    latitude: venueValid ? venueLat : null,
    longitude: venueValid ? venueLng : null,
    createdAt: existingFestival?.createdAt || now,
    updatedAt: now,
  };
}

// ── Poll Schemas ──────────────────────────────────────────────────
export const crewHomeBaseSchema = z.object({
  location: z.string().trim().max(200).optional().nullable(),
  time: z.string().trim().max(100).optional().nullable(),
  // T54: undefined keeps the stored Plan B; null or '' clears it.
  planB: z.string().trim().max(140).optional().nullable(),
});

// M6 Crew Photo Wall (Phase 1, link-out only). A single shared-album URL per
// crew (e.g. Google Photos / Apple shared album). https-only and length-bounded
// to avoid javascript:/data: schemes and oversized values; nullable / empty so
// a member can clear the link. Festie hosts no photos yet — this is a link-out.
export const crewPhotoAlbumSchema = z.object({
  photoAlbumUrl: z
    .string()
    .trim()
    .url('Must be a valid URL')
    .max(2048)
    .refine((u) => u.startsWith('https://'), 'Must be an https URL')
    .nullable()
    .optional()
    .or(z.literal('')),
});

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

const pollCreateSchema = z
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
const pollVoteSchema = z
  .object({
    optionIndex: z.number().int().min(0).max(3).optional(),
    optionIndexes: z.array(z.number().int().min(0).max(3)).max(4).optional(),
  })
  .refine((b) => (b.optionIndex === undefined) !== (b.optionIndexes === undefined), {
    message: 'Send optionIndex or optionIndexes',
    path: ['optionIndexes'],
  });

// ── Crew packing-board schemas (M2 logistics) ───────────────────────
const packingCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(200),
  broughtBy: z.string().trim().max(100).optional().nullable(),
  claimed: z.boolean().optional(),
});

const packingUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    broughtBy: z.string().trim().max(100).optional().nullable(),
    claimed: z.boolean().optional(),
    packed: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== undefined), {
    message: 'At least one field required',
  });

const packingBatchSchema = z.object({
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

const crewStatusSchema = z
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

const locationShareSchema = z
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

const locationUpdateSchema = z
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

const locationStopSchema = z
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
const locationSyncSchema = z
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
const rideCreateSchema = z.object({
  driver: z.string().trim().max(100).optional().nullable(),
  seats: z.number().int().min(0).max(99).optional().nullable(),
  departFrom: z.string().trim().max(200).optional().nullable(),
  departAt: z.string().trim().max(100).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  direction: z.enum(['to_festival', 'home']).optional().nullable(),
  departTime: z.string().datetime().optional().nullable(),
});

const rideUpdateSchema = z
  .object({
    driver: z.string().trim().max(100).optional().nullable(),
    seats: z.number().int().min(0).max(99).optional().nullable(),
    departFrom: z.string().trim().max(200).optional().nullable(),
    departAt: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
    direction: z.enum(['to_festival', 'home']).optional().nullable(),
    departTime: z.string().datetime().optional().nullable(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== undefined), {
    message: 'At least one field required',
  });

// ── Refresh Token schema ────────────────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── Rating schemas ──────────────────────────────────────────────
const ratingCreateSchema = z.object({
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

// ── Expense schemas ─────────────────────────────────────────────
// Keep in sync with CREW_CURRENCIES in packages/shared/src/constants/config.ts
// (the backend cannot import @festie/shared, see lib/time-zone.ts). USD is the
// only currency for new writes (FND-082); crews that already store another
// code keep it, and every read path still accepts any string.
export const CREW_CURRENCIES = ['USD'] as const;

const expenseShareSchema = z.object({
  userId: z.string().min(1).max(100),
  cents: z.number().int().positive().max(9_999_999_999),
});

// Column is NUMERIC(10,2) with CHECK (amount > 0): below 0.01 rounds to 0, above 99,999,999.99 overflows.
const expenseAmount = z.number().min(0.01).max(99_999_999.99);

const expenseCreateSchema = z
  .object({
    description: z.string().min(1).max(200),
    amount: expenseAmount,
    // User IDs are TEXT (e.g. "user-<uuid>"), not integers — clients send strings.
    // Typing these as numbers 400'd every real expense create/settle.
    splitWith: z.array(z.string().min(1)).min(1),
    category: z.string().max(50).optional(),
    // Budget = planned expenses. A planned row is a forecast and is EXCLUDED from
    // the balance ledger / settle-up (see getBalances). Defaults to actual (false).
    planned: z.boolean().optional(),
    // The member who paid. Defaults to the caller on the server.
    paidBy: z.string().min(1).max(100).optional(),
    // Uneven split in integer cents. Absent = equal split across splitWith.
    shares: z.array(expenseShareSchema).min(1).max(30).optional(),
  })
  .superRefine((d, ctx) => {
    // Payments come only from POST /expenses/settle; this blocks forged "A paid B" rows and edits into a payment.
    if (d.category === 'settlement') {
      ctx.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Record a payment with Settle up, not as an expense.',
      });
    }
    if (!d.shares) return;
    const shareIds = d.shares.map((s) => s.userId);
    const shareSet = new Set(shareIds);
    if (shareSet.size !== shareIds.length) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Each person can appear once in the shares.' });
    }
    const splitSet = new Set(d.splitWith);
    if (shareSet.size !== splitSet.size || [...shareSet].some((id) => !splitSet.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must list the same people as the split.' });
    }
    const sum = d.shares.reduce((acc, s) => acc + s.cents, 0);
    if (sum !== Math.round(d.amount * 100)) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must add up to the total.' });
    }
  });

// PUT is a full replacement: the edit form sends every field, so it reuses the
// create schema (one validation path, last-write-wins offline replay).
const expenseUpdateSchema = expenseCreateSchema;

const expenseCurrencySchema = z.object({ currency: z.enum(CREW_CURRENCIES) });

const expenseConfirmSchema = z.object({ received: z.boolean() });

// `userId` is the member who owes the caller.
const expenseRemindSchema = z.object({ userId: z.string().min(1).max(100) });

// ── Admin bulk schemas ──────────────────────────────────────────
export const adminBulkDeactivateSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});

const adminBulkArchiveSchema = z.object({
  festivalIds: z.array(z.string().min(1)).min(1),
});

// ── Admin role schema ───────────────────────────────────────────
const adminAddRoleSchema = z.object({
  role: z.string().min(1).max(50),
});

// ── Pagination query schema ────────────────────────────────────
export const paginationQuery = z.object({
  // Postgres rejects NUL in text parameters, which would surface as a 500.
  cursor: z.string().refine((v) => !v.includes('\u0000'), 'Invalid cursor').optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PUBLIC_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

// ── Admin audit query schema ──────────────────────────────────
const validDateString = z.string().refine((v) => !isNaN(new Date(v).getTime()), 'Must be a valid date string');
export const adminAuditQuery = z.object({
  actor_id: z.string().trim().max(100).optional(),
  // A comma list matches any item. A trailing `.*` on an item asks for a prefix match: `festival.*` matches `festival.created`.
  action: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-z0-9_.:-]+(\.\*)?(,[a-z0-9_.:-]+(\.\*)?){0,4}$/i)
    .optional(),
  resource_type: z.string().trim().max(100).optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  from: validDateString.optional(),
  to: validDateString.optional(),
  scope: z.enum(['admin', 'user', 'all']).default('admin'),
  actor: z.string().trim().max(100).optional(),
  user: z.string().trim().max(100).optional(),
});

// ── Admin analytics query schema ──────────────────────────────
export const adminAnalyticsQuery = z.object({
  festivalId: z.string().trim().min(1).max(100).optional(),
});

// ── Admin sign-up ref counts query schema ─────────────────────
export const adminRefCountsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

// ── Admin user search query schema ────────────────────────────
const adminUserSearchQuery = z.object({
  search: z.string().trim().max(200).optional(),
});

// ── Festival detail depth query schema ────────────────────────
export const festivalDepthQuery = z.object({
  depth: z.coerce.number().int().min(0).max(2).optional(),
});

// ── Festival delete query schema ──────────────────────────────
const festivalDeleteQuery = z.object({
  hard: z.enum(['true', 'false']).optional(),
});

// ── Crew search query schema ──────────────────────────────────
const crewUserSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
});

// ── Crew list query schema ────────────────────────────────────
const crewListQuery = z.object({
  festivalId: z.string().max(100).optional(),
});

// ── Expense settle schema (extended with amount) ──────────────
const expenseSettleFullSchema = z.object({
  toUserId: z.string().min(1),
  amount: expenseAmount,
});

// ── Route param schemas ────────────────────────────────────────
export const crewIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
});

const crewIdExpenseIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  expenseId: z.string().min(1, 'Expense ID required').max(100),
});

const crewIdPollIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  pollId: z.string().min(1, 'Poll ID required').max(100),
});

export const crewIdMpIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  mpId: z.string().min(1, 'Meeting point ID required').max(100),
});

export const crewIdUserIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Invalid user ID'),
});

const crewIdItemIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  itemId: z.string().min(1, 'Item ID required').max(100),
});

const setIdParams = z.object({
  setId: z.string().min(1, 'Set ID required').max(100),
});

const crewIdFestivalIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  festivalId: z.string().min(1, 'Festival ID required').max(100),
});

export const festivalIdParams = z.object({
  festivalId: z.string().min(1, 'Festival ID required').max(100),
});

const genericIdParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
});

const idUserIdParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
  userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Invalid user ID'),
});

const idRoleParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
  role: z.string().trim().toLowerCase().pipe(z.enum(['admin', 'user'])),
});

const alsoPickedParams = z.object({
  festivalId: identifier,
  setId: identifier,
});

const profileIdParams = z.object({
  id: z.string().min(1, 'Profile ID required').max(100),
});

// ════════════════════════════════════════════════════════════════════════════════
// Bundled schemas export (preserves the original `schemas` namespace for
// consumers that import as `const { schemas } = require('./schemas')`)
// ════════════════════════════════════════════════════════════════════════════════

export const schemas = {
  register: registerSchema,
  login: loginSchema,
  changePassword: changePasswordSchema,
  profileUpdate: profileUpdateSchema,
  joinFestival: joinFestivalSchema,
  resetPassword: resetPasswordSchema,
  resetPasswordPublic: resetPasswordPublicSchema,
  notificationPrefs: notificationPrefsSchema,
  pushToken: pushTokenSchema,
  deleteToken: deleteTokenSchema,
  markRead: markReadSchema,
  usernameChange: usernameChangeSchema,
  displayNameChange: displayNameChangeSchema,
  paymentHandles: paymentHandlesSchema,
  publicSchedule: publicScheduleSchema,
  accountDelete: accountDeleteSchema,
  reauth: reauthSchema,
  oauthSignIn: oauthSignInSchema,
  oauthComplete: oauthCompleteSchema,
  oauthProviderParams,
  setPassword: setPasswordSchema,
  topicSubscription: topicSubscriptionSchema,
  festivalCreate: festivalCreateSchema,
  festivalUpdate: festivalUpdateSchema,
  festivalMapConfig: festivalMapConfigSchema,
  crewCreate: crewCreateSchema,
  crewUpdate: crewUpdateSchema,
  crewJoin: crewJoinSchema,
  crewInviteCodeParams,
  crewReform: crewReformSchema,
  crewTransfer: crewTransferSchema,
  crewAddMember: crewAddMemberSchema,
  setLink: setLinkSchema,
  artistMatch: artistMatchSchema,
  artistCreate: artistCreateSchema,
  artistUpdate: artistUpdateSchema,
  artistMerge: artistMergeSchema,
  artistBackfill: artistBackfillSchema,
  policyNotice: policyNoticeSchema,
  artistListQuery: artistListQuerySchema,
  artistSpotifyCandidates: artistSpotifyCandidatesSchema,
  artistSpotifyPicks: artistSpotifyPicksSchema,
  spotifyBackfill: spotifyBackfillSchema,
  festivalAnnouncement: festivalAnnouncementSchema,
  timeReleaseSend: timeReleaseSendSchema,
  crewHomeBase: crewHomeBaseSchema,
  crewPhotoAlbum: crewPhotoAlbumSchema,
  meetingPointCreate: meetingPointCreateSchema,
  meetingPointUpdate: meetingPointUpdateSchema,
  meetingPointComing: meetingPointComingSchema,
  crewDays: crewDaysSchema,
  pollCreate: pollCreateSchema,
  pollVote: pollVoteSchema,
  packingCreate: packingCreateSchema,
  packingUpdate: packingUpdateSchema,
  packingBatch: packingBatchSchema,
  crewStatus: crewStatusSchema,
  locationShare: locationShareSchema,
  locationUpdate: locationUpdateSchema,
  locationStop: locationStopSchema,
  liveLocationFix: liveLocationFixSchema,
  locationSync: locationSyncSchema,
  sosRaise: sosRaiseSchema,
  sosClear: sosClearSchema,
  sosSeen: sosSeenSchema,
  checkinStart: checkinStartSchema,
  rideCreate: rideCreateSchema,
  rideUpdate: rideUpdateSchema,
  forgotPassword: forgotPasswordSchema,
  updateEmail: updateEmailSchema,
  refreshToken: refreshTokenSchema,
  ratingCreate: ratingCreateSchema,
  caughtUpdate: caughtUpdateSchema,
  wrapQuery,
  expenseCreate: expenseCreateSchema,
  expenseUpdate: expenseUpdateSchema,
  expenseCurrency: expenseCurrencySchema,
  expenseConfirm: expenseConfirmSchema,
  expenseRemind: expenseRemindSchema,
  adminBulkDeactivate: adminBulkDeactivateSchema,
  adminBulkArchive: adminBulkArchiveSchema,
  adminAddRole: adminAddRoleSchema,
  paginationQuery,
  adminAuditQuery,
  adminAnalyticsQuery,
  adminRefCountsQuery,
  adminUserSearchQuery,
  festivalDepthQuery,
  festivalDeleteQuery,
  crewUserSearchQuery,
  crewListQuery,
  expenseSettleFull: expenseSettleFullSchema,
  crewIdParams,
  crewIdExpenseIdParams,
  crewIdPollIdParams,
  crewIdMpIdParams,
  crewIdUserIdParams,
  crewIdItemIdParams,
  setIdParams,
  crewIdFestivalIdParams,
  festivalIdParams,
  genericIdParams,
  idUserIdParams,
  idRoleParams,
  alsoPickedParams,
  profileIdParams,
};
