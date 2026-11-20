// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { MAX_ARTISTS_PER_SET, ALLOWED_PICK_PRIORITIES, ALLOWED_REMINDER_MINUTES } from '../constants';
import { sanitizeLinkRecord, sanitizeString, normalizeRecordKey, sanitizeIdentifier, validateTime, validateColor } from '../helpers';
import { normalizeLineup, todayInZone } from '../lineup';
import type { AppConfig } from '../config';

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
