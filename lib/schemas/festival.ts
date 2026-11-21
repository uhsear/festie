// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { ALLOWED_LINK_PLATFORMS, MAX_ARTISTS_PER_SET } from '../constants';
import { isIanaTimeZone } from './account';
import { TILES_PATH_RE } from '../tiles';

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
    // A same-origin /tiles/<name>.pmtiles path (self-hosted, see lib/tiles.ts) or an https URL.
    // The festival routes store the path as an absolute URL, so clients only ever see https.
    pmtilesUrl: z.union(
      [
        z.string().regex(TILES_PATH_RE),
        z.string().url().max(2048).startsWith('https://', 'PMTiles URL must be https'),
      ],
      { message: 'PMTiles URL must be https or a /tiles/<name>.pmtiles path' },
    ),
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

export const festivalCreateSchema = z.object({
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

export const festivalUpdateSchema = festivalCreateSchema
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
  // true answers with the alert notice a save would give and writes nothing, so a confirm dialog can show the count.
  .extend({ dryRun: z.boolean().optional() })
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
