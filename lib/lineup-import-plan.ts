// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Lineup import plan: matches JSON rows from the client against a festival and
 * decides, row by row, what an import would create or change. Pure: no database.
 *
 * Preview and commit both call planLineupImport. Commit calls it again inside
 * the write transaction, so what it writes always matches the locked festival.
 * Imports never delete. A field the row leaves out is left alone; an empty
 * string in a mapped field clears that value.
 *
 * A row with names (and links) but no day, stage or time is an announced row: it adds to, or fills
 * in, festivals.lineup. A row with a set id and another day is skipped, or moves the set when
 * options.moveDays is on. Artist names resolve per name against ctx.input.artists (see
 * artistLookupKeys): one live artist attaches its id, several stop the row at "Needs choice"
 * until a row names the id, and a set or entry that already holds the artist keeps it.
 *
 * A new set that covers an announced act (same artist name keys) takes the act's poster name, so
 * "Port Zero presents: ..." survives the move from the announced list to the timetable. The plan also
 * names the announced acts on the days this import fills that no set covers once it is written.
 */

import { MAX_ARTISTS_PER_SET } from './constants';
import type { LineupImportRowInput } from './schemas';
import { sanitizeString } from './helpers/sanitize';
import { dayRunsLate, formatSetLength, setTimeFlags, validateColor, validateTime } from './helpers/validation';
import { artistNameKey } from './artist-key';
import { ARTIST_LINK_LABELS, detectPlatform, normalizeArtistLink, type ArtistLinkPlatform } from './artist-links';
import { MAX_LINEUP_ENTRIES, lineupEntryKey, lineupFoldKey, lineupNameKey, todayInZone } from './lineup';

type ErrorField = 'artist' | 'day' | 'date' | 'stage' | 'startTime' | 'endTime' | 'link' | 'row';
export type LineupImportRowStatus = 'new' | 'changed' | 'unchanged' | 'error';

/** One live artist row from the artist repository, as the import needs it. */
export interface ArtistRef {
  id: string;
  name: string;
  label: string;
  links: Record<string, string>;
  photo: string | null;
  genres: string[];
  mergedInto: string | null;
}

/** byKey holds live artists only. byId also holds merged ones, so a stale id gets a clear message. */
export interface ArtistLookup {
  byKey: Map<string, ArtistRef[]>;
  byId: Map<string, ArtistRef>;
}

/** The lookup with each locked row swapped in for its earlier copy. */
export function withLockedArtists(lookup: ArtistLookup, locked: Map<string, ArtistRef>): ArtistLookup {
  const fresh = (ref: ArtistRef) => locked.get(ref.id) ?? ref;
  return {
    byId: new Map([...lookup.byId].map(([id, ref]) => [id, fresh(ref)])),
    byKey: new Map([...lookup.byKey].map(([key, refs]) => [key, refs.map(fresh)])),
  };
}

export interface ArtistCandidate {
  id: string;
  label: string;
  hint: string;
}

/** What the import decided for one artist name of a row. */
export interface ArtistResolution {
  name: string;
  outcome: 'existing' | 'needs_choice' | 'did_you_mean' | 'new';
  artistId?: string;
  candidates?: ArtistCandidate[];
  suggestion?: string;
}

export interface LineupImportPlanRow {
  row: number;
  status: LineupImportRowStatus;
  /** 'announced' rows add to or update the announced lineup, not the schedule. */
  target?: 'announced';
  setId?: string;
  artists: string[];
  dayLabel?: string;
  stageName?: string;
  startTime?: string | null;
  endTime?: string | null;
  /** The poster name a new set takes from the announced act it covers. */
  displayName?: string;
  changes: string[];
  errors: { field: ErrorField; message: string; code?: 'needs_choice' }[];
  warnings: string[];
  resolutions: ArtistResolution[];
  /** Why the row was left out. The row has status unchanged and writes nothing. */
  skipped?: string;
}

export interface LineupImportPlan {
  festivalName: string;
  counts: {
    new: number;
    changed: number;
    unchanged: number;
    error: number;
    skipped: number;
    newStages: number;
    newDays: number;
    missingFromFile: number;
    /** Rows that add an entry to the announced lineup (they also count in `new`). */
    announced: number;
    needsChoice: number;
  };
  rows: LineupImportPlanRow[];
  newStages: { name: string; color: string }[];
  newDays: { label: string; date: string }[];
  missingFromFile: { setId: string; artist: string; dayLabel: string }[];
  /** Announced acts dated to a day this import fills that no set covers afterwards. */
  unmatchedActs: { entryId: string; name: string; dayLabel: string }[];
  problems: string[];
  stages: string[];
  days: string[];
}

export interface ArtistEntry {
  name: string;
  links: Record<string, string>;
  id?: string;
  [extra: string]: unknown;
}

/** One billing line of festivals.lineup. */
export interface LineupEntryValue {
  id: string;
  artists: ArtistEntry[];
  displayName: string | null;
  tier: number | null;
  dayDate: string | null;
  status: string;
  announcedAt: string;
  linkedSetIds: string[];
  [extra: string]: unknown;
}

/** The columns of a festival_sets row that an import writes. */
export interface SetValues {
  stageId: string;
  startTime: string | null;
  endTime: string | null;
  artist: string;
  artists: ArtistEntry[];
  linkUrl: string | null;
  displayName: string | null;
}

export interface LineupImportWrites {
  newStages: { id: string; name: string; color: string }[];
  newDays: { dayIndex: number; label: string; date: string }[];
  inserts: (SetValues & { index: number; id: string; dayIndex: number })[];
  /** dayMove is set when the set changes day: from and to are day indexes. */
  updates: { index: number; setId: string; before: SetValues; after: SetValues; dayMove?: { from: number; to: number } }[];
  announced: {
    inserts: { index: number; entry: LineupEntryValue }[];
    updates: { index: number; id: string; before: LineupEntryValue; after: LineupEntryValue }[];
  };
  /** Artist repository ids that the writes attach. Commit checks they are still live. */
  artistIds: string[];
  /** Always 0. The import no longer searches Spotify; the field stays so the response shape does not change. */
  spotifyMatched: number;
}

export interface PlanInput {
  festival: any;
  rows: LineupImportRowInput[];
  options: { updateExisting: boolean; createMissing: boolean; moveDays?: boolean };
  config: { MAX_IMPORT_SETS: number; MAX_STAGES: number; MAX_DAYS: number; MAX_SETS_PER_DAY: number };
  /** Artist repository rows for the row names and ids (see artistLookupKeys). Absent means no artist matches. */
  artists?: ArtistLookup;
  /** Id factory for new stages and sets. The default is deterministic, for previews. */
  makeId?: (prefix: string) => string;
}

const DEFAULT_STAGE_COLOR = '#6a6a88';
const AFTER_MIDNIGHT_CUTOFF = '06:00';

// Artist names also fold accents and curly quotes. They keep "The" and punctuation, so import never merges two artists.
const normKey = lineupFoldKey;
// Stage names fold only the curly apostrophes, so "Dragon’s Den" matches "Dragon's Den" but accents still tell stages apart.
const stageKey = (s: string) => s.toLowerCase().replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blankToNull = (v: any): string | null => (typeof v === 'string' && v ? v : null);

/** Normalises "9pm", "9:30 PM" and "21:00:00" to HH:MM. Anything else comes back trimmed. */
export function normalizeTime(raw: string): string {
  const stripped = raw.trim().replace(/\s+/g, ' ');
  if (/^\d{1,2}:\d{2}$/.test(stripped)) return stripped.padStart(5, '0');
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(stripped)) return stripped.slice(0, -3).padStart(5, '0');
  const match12 = stripped.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (match12) {
    let h = parseInt(match12[1]!, 10);
    const m = parseInt(match12[2] || '0', 10);
    const period = match12[3]!.toLowerCase();
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return stripped;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

interface DayInfo {
  key: string;
  index?: number; // existing days only; new days get theirs at the end
  label: string;
  date: string;
}

interface ExistingSet {
  id: string;
  dayKey: string;
  dayLabel: string;
  key: string;
  names: string[];
  values: SetValues;
}

interface ScheduleEntry {
  rowIndex: number | null;
  dayKey: string;
  stageId: string;
  artist: string;
  start: string | null;
  end: string | null;
}

/** Splits one billing text into artist names. The festival's separator and " b2b " both split. */
function nameSplitter(festival: any) {
  const sep = sanitizeString(festival.b2bSeparator || 'b2b', 10) || 'b2b';
  const splitRe = new RegExp(`\\s+(?:${escapeRe(sep)}|b2b)\\s+`, 'i');
  const splitNames = (raw: string) =>
    raw
      .split(splitRe)
      .map((n) => sanitizeString(n, 300))
      .filter(Boolean);
  return { sep, splitNames };
}

/** The artist ids of a row: one per name, "|" between them. An empty position stays empty. */
function parseArtistIds(raw: string | undefined): string[] {
  const value = (raw ?? '').trim();
  return value ? value.split('|').map((id) => id.trim()) : [];
}

/** The name keys and ids of every row, for one artist lookup before the plan runs. */
export function artistLookupKeys(festival: any, rows: LineupImportRowInput[]): { keys: string[]; ids: string[] } {
  const { splitNames } = nameSplitter(festival);
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const row of rows) {
    for (const name of splitNames(row.artist)) keys.add(artistNameKey(name));
    for (const id of parseArtistIds(row.artistId)) if (id) ids.add(id);
  }
  return { keys: [...keys], ids: [...ids] };
}

/** Builds the import plan and the writes a commit would make. */
export function planLineupImport(input: PlanInput): { plan: LineupImportPlan; writes: LineupImportWrites } {
  const ctx = createContext(input);
  input.rows.forEach((row, index) => planRow(ctx, row, index));
  addOverlapErrors(ctx);
  addTimeWarnings(ctx);
  return finish(ctx);
}

function createContext(input: PlanInput) {
  const { festival } = input;
  let counter = 0;
  const makeId = input.makeId ?? ((prefix: string) => `${prefix}-preview-${++counter}`);
  const { sep, splitNames } = nameSplitter(festival);

  const stages: { id: string; name: string; color: string; isNew: boolean }[] = (festival.stages || []).map(
    (s: any) => ({ id: s.id, name: s.name, color: s.color, isNew: false }),
  );
  const days: DayInfo[] = (festival.days || []).map((d: any, i: number) => ({
    key: `e${i}`,
    index: d.dayIndex ?? i,
    label: d.label || '',
    date: d.date || '',
  }));
  const existingDayCount = days.length;
  const lineup: LineupEntryValue[] = Array.isArray(festival.lineup) ? festival.lineup : [];
  const posterNames = new Map<string, string>();
  for (const entry of lineup) {
    if (entry.status !== 'cancelled' && entry.displayName) posterNames.set(lineupEntryKey(entry), entry.displayName);
  }
  const lastExistingDate = days.reduce((max, d) => (d.date > max ? d.date : max), '');
  const existing: ExistingSet[] = (festival.days || []).flatMap((d: any, i: number) =>
    (d.sets || []).map((s: any) => {
      const artists: ArtistEntry[] =
        Array.isArray(s.artists) && s.artists.length > 0
          ? s.artists
          : [{ name: s.artist || '', links: s.linkUrl ? { spotify: s.linkUrl } : {} }];
      const names = Array.isArray(s.artists) && s.artists.length > 0 ? s.artists.map((a: any) => a.name) : splitNames(s.artist || '');
      return {
        id: s.id,
        dayKey: `e${i}`,
        dayLabel: d.label || '',
        key: names.map(normKey).join('|'),
        names,
        values: {
          stageId: s.stageId,
          startTime: blankToNull(s.startTime),
          endTime: blankToNull(s.endTime),
          artist: s.artist || '',
          artists,
          linkUrl: blankToNull(s.linkUrl),
          displayName: blankToNull(s.displayName),
        },
      };
    }),
  );
  const lineupByKey = new Map<string, LineupEntryValue>();
  for (const entry of lineup) {
    const key = lineupEntryKey(entry);
    if (key && !lineupByKey.has(key)) lineupByKey.set(key, entry);
  }

  // Announced acts no set covers. The CSV export lists each as a row with no stage and no times.
  const coveredKeys = new Set(existing.map((s) => lineupEntryKey({ artists: s.names.map((name) => ({ name })) })));
  const unplacedKeys = new Set<string>(
    lineup.filter((entry) => entry.status !== 'cancelled' && !coveredKeys.has(lineupEntryKey(entry))).map(lineupEntryKey),
  );

  return {
    input,
    makeId,
    sep,
    splitNames,
    stages,
    days,
    existingDayCount,
    lastExistingDate,
    existing,
    lineup,
    posterNames,
    filledDays: new Set<string>(),
    unplacedKeys,
    existingById: new Map(existing.map((s) => [s.id, s])),
    lineupByKey,
    today: todayInZone(festival.timeZone),
    planRows: [] as LineupImportPlanRow[],
    matchedIds: new Set<string>(),
    firstRowOf: new Map<string, number>(),
    inserts: [] as (SetValues & { index: number; id: string; dayKey: string })[],
    updates: [] as (LineupImportWrites['updates'][number] & { dayKey?: string })[],
    announcedInserts: [] as LineupImportWrites['announced']['inserts'],
    announcedUpdates: [] as LineupImportWrites['announced']['updates'],
    lookedUpIds: new Set<string>(),
    schedule: [] as ScheduleEntry[],
    spotifyMatched: 0,
  };
}

type Ctx = ReturnType<typeof createContext>;
type RowErrors = LineupImportPlanRow['errors'];

const dayLabels = (ctx: Ctx) => ctx.days.map((d) => d.label || d.date).join(', ') || 'none yet';
const stageNameOf = (ctx: Ctx, id: string | undefined) => ctx.stages.find((s) => s.id === id)?.name;

/** Returns the day, undefined when the row names none, or null after an error. */
function resolveDay(ctx: Ctx, row: LineupImportRowInput, errors: RowErrors): DayInfo | undefined | null {
  const day = sanitizeString(row.day ?? '', 100);
  // A date typed in the Day column counts as the date when no Date column is mapped.
  const date = (row.date ?? '').trim() || (isIsoDate(day) ? day : '');
  const { createMissing } = ctx.input.options;
  if (date) {
    if (!isIsoDate(date)) {
      errors.push({ field: 'date', message: `Date "${date}" is not a date. Use YYYY-MM-DD.` });
      return null;
    }
    const found = ctx.days.find((d) => d.date === date);
    if (found) return found;
    // A day with this label but no date is the same day; one with another date is a conflict, not a new day.
    const byLabel = day && day !== date ? ctx.days.find((d) => d.label.toLowerCase() === day.toLowerCase()) : undefined;
    if (byLabel && !byLabel.date) return byLabel;
    if (byLabel) {
      errors.push({
        field: 'date',
        message: `Day "${byLabel.label}" is dated ${byLabel.date}, not ${date}. Fix the date or the day.`,
      });
      return null;
    }
    if (!createMissing) {
      errors.push({
        field: 'day',
        message: `Unknown day "${day || date}". Use one of: ${dayLabels(ctx)}, or tick Create new stages and days.`,
      });
      return null;
    }
    if (date <= ctx.lastExistingDate) {
      errors.push({
        field: 'date',
        message: `New day ${date} comes before the festival's last day. Add it in the festival editor first.`,
      });
      return null;
    }
    const created: DayInfo = { key: `n${date}`, label: day || date, date };
    ctx.days.push(created);
    return created;
  }
  if (!day) return undefined;

  const lower = day.toLowerCase();
  const numberMatch = day.match(/^(?:day\s*)?(\d{1,2})$/i);
  const prefixHits = /^[a-z]{3,}$/i.test(day) ? ctx.days.filter((d) => d.label.toLowerCase().startsWith(lower)) : [];
  const found =
    ctx.days.find((d) => d.label.toLowerCase() === lower) ??
    ctx.days.find((d) => d.date === day) ??
    (numberMatch ? ctx.days[Number(numberMatch[1]) - 1] : undefined) ??
    (prefixHits.length === 1 ? prefixHits[0] : undefined);
  if (found) return found;
  errors.push({
    field: 'day',
    message: `Unknown day "${day}". Use one of: ${dayLabels(ctx)}, or add a Date column to create it.`,
  });
  return null;
}

/** Returns the stage id, undefined when the row names none, or null after an error. */
function resolveStage(ctx: Ctx, row: LineupImportRowInput, errors: RowErrors): string | undefined | null {
  const raw = sanitizeString(row.stage ?? '', 100);
  if (!raw) return undefined;
  const key = stageKey(raw);
  const found = ctx.stages.find((s) => stageKey(s.name) === key || s.id === raw);
  if (found) return found.id;
  if (!ctx.input.options.createMissing) {
    const names = ctx.stages.map((s) => s.name).join(', ') || 'none yet';
    errors.push({
      field: 'stage',
      message: `Unknown stage "${raw}". Use one of: ${names}, or tick Create new stages and days.`,
    });
    return null;
  }
  const color = (row.stageColor ?? '').trim();
  const created = {
    id: ctx.makeId('stage-import'),
    name: raw,
    color: validateColor(color) ? color : DEFAULT_STAGE_COLOR,
    isNew: true,
  };
  ctx.stages.push(created);
  return created.id;
}

/** Returns HH:MM, null for TBA, undefined when the field is not mapped or after an error. */
function readTime(raw: string | undefined, field: 'startTime' | 'endTime', errors: RowErrors) {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!value || /^tb[ad]$/i.test(value)) return null;
  const time = normalizeTime(value);
  if (validateTime(time)) return time;
  const label = field === 'startTime' ? 'Start' : 'End';
  errors.push({ field, message: `${label} time "${value}" is not a time. Use 21:00 or 9pm.` });
  return undefined;
}

type LinkChanges = Partial<Record<ArtistLinkPlatform, string | null>>;

// The platforms with a column in the import file. youtube and apple_music have none: they come from the Artists tab.
const IMPORT_LINK_PLATFORMS = ['spotify', 'soundcloud', 'instagram', 'twitter', 'tiktok', 'facebook', 'website'] as const satisfies readonly ArtistLinkPlatform[];

/** Platform to clean link. null clears that link; a platform that is absent stays as it is. */
function readLinks(row: LineupImportRowInput, warnings: string[]): LinkChanges {
  const out: LinkChanges = {};
  const put = (platform: ArtistLinkPlatform, raw: string, label: string) => {
    const result = normalizeArtistLink(platform, raw);
    if (result.ok) out[platform] = result.url;
    else warnings.push(`${label} dropped. ${result.message}`);
  };
  if (row.link !== undefined) {
    const value = row.link.trim();
    // An empty single link column has no host to read, so it keeps its old meaning: clear the Spotify link.
    if (!value) out.spotify = null;
    else put(detectPlatform(value) ?? 'website', value, 'Link');
  }
  for (const platform of IMPORT_LINK_PLATFORMS) {
    const raw = row[platform];
    if (raw === undefined) continue;
    if (!raw.trim()) out[platform] = null;
    else put(platform, raw.trim(), `${ARTIST_LINK_LABELS[platform]} link`);
  }
  return out;
}

function applyLinks(artist: ArtistEntry | undefined, links: LinkChanges) {
  if (!artist) return;
  for (const [platform, url] of Object.entries(links)) {
    if (url) artist.links[platform] = url;
    else delete artist.links[platform];
  }
}

function describeLinkChanges(before: Record<string, string>, after: Record<string, string>, links: LinkChanges, fallback?: string | null): string[] {
  const out: string[] = [];
  for (const platform of Object.keys(links) as ArtistLinkPlatform[]) {
    const old = blankToNull(before[platform]) ?? (platform === 'spotify' ? (fallback ?? null) : null);
    const next = blankToNull(after[platform]);
    if (old !== next) out.push(`${ARTIST_LINK_LABELS[platform]} link ${old ?? 'none'} → ${next ?? 'none'}`);
  }
  return out;
}

const dayName = (d: DayInfo | undefined) => d?.label || d?.date || '';
const isBlank = (v: string | undefined) => !(v ?? '').trim();

function artistFromRef(name: string, ref: ArtistRef): ArtistEntry {
  return {
    name,
    id: ref.id,
    links: { ...ref.links },
    ...(ref.photo ? { photo: ref.photo } : {}),
    ...(ref.genres.length > 0 ? { genres: ref.genres } : {}),
  };
}

const candidateOf = (ref: ArtistRef): ArtistCandidate => {
  const url = ref.links.spotify ?? Object.values(ref.links)[0] ?? '';
  return { id: ref.id, label: ref.label, hint: url.replace(/^https?:\/\/(?:www\.)?/, '') };
};

interface ResolveOptions {
  /** The stored artist that a typed name stands for, so its id, links and photo carry over. */
  findStored: (name: string) => ArtistEntry | undefined;
  /** A set takes the name as typed; an announced entry keeps the stored spelling. */
  renameToRow: boolean;
}

/**
 * Decides, per name, which artist it is: an explicit id, the stored artist of the set or entry,
 * one live artist with the same key, or none. Several live artists with one key need a choice.
 */
function resolveArtists(ctx: Ctx, names: string[], ids: string[], opts: ResolveOptions, errors: RowErrors, warnings: string[]) {
  const lookup = ctx.input.artists;
  const artists: ArtistEntry[] = [];
  const resolutions: ArtistResolution[] = [];
  names.forEach((name, i) => {
    const kept = opts.findStored(name);
    const keptCopy = (): ArtistEntry => ({ ...kept!, name: opts.renameToRow ? name : kept!.name, links: { ...(kept!.links || {}) } });
    const plain = (): ArtistEntry => (kept ? keptCopy() : { name, links: {} });
    const id = ids[i];
    if (id) {
      const ref = lookup?.byId.get(id);
      if (!ref || ref.mergedInto) {
        const why = ref ? 'was merged into another artist' : 'is not known';
        errors.push({ field: 'artist', message: `Artist id "${id}" ${why}. Remove the id, or pick the artist again.` });
        artists.push(plain());
        resolutions.push({ name, outcome: 'new' });
        return;
      }
      ctx.lookedUpIds.add(ref.id);
      if (artistNameKey(ref.name) !== artistNameKey(name)) {
        warnings.push(`"${name}" is not the name of artist "${ref.name}". The artist id wins.`);
      }
      artists.push(kept ? { ...keptCopy(), id: ref.id } : artistFromRef(name, ref));
      resolutions.push({ name, outcome: 'existing', artistId: ref.id });
      return;
    }
    if (kept) {
      artists.push(keptCopy());
      resolutions.push({ name, outcome: 'existing', ...(kept.id ? { artistId: kept.id } : {}) });
      return;
    }
    const hits = lookup?.byKey.get(artistNameKey(name)) ?? [];
    if (hits.length === 1) {
      ctx.lookedUpIds.add(hits[0]!.id);
      artists.push(artistFromRef(name, hits[0]!));
      resolutions.push({ name, outcome: 'existing', artistId: hits[0]!.id });
    } else if (hits.length > 1) {
      errors.push({
        field: 'artist',
        code: 'needs_choice',
        message: `Which "${name}"? ${hits.length} artists have this name. Pick one.`,
      });
      artists.push({ name, links: {} });
      resolutions.push({ name, outcome: 'needs_choice', candidates: hits.map(candidateOf) });
    } else {
      artists.push({ name, links: {} });
      resolutions.push({ name, outcome: 'new' });
    }
  });
  return { artists, resolutions };
}

/** A single new name that is one edit or two from a stored act becomes "Did you mean". */
function markNear(resolutions: ArtistResolution[], suggestion: string) {
  if (resolutions.length === 1 && resolutions[0]!.outcome === 'new') {
    resolutions[0] = { ...resolutions[0]!, outcome: 'did_you_mean', suggestion };
  }
}

function findMatch(ctx: Ctx, row: LineupImportRowInput, key: string, day: DayInfo | undefined, stageId: string | undefined, errors: RowErrors) {
  if (row.setId !== undefined && row.setId.trim()) {
    const byId = ctx.existingById.get(row.setId.trim());
    if (!byId) errors.push({ field: 'row', message: 'This id belongs to another festival.' });
    return byId;
  }
  let cands = ctx.existing.filter((s) => s.key === key && (!day || s.dayKey === day.key));
  if (cands.length > 1 && stageId) cands = cands.filter((s) => s.values.stageId === stageId);
  if (cands.length <= 1) return cands[0];
  cands.forEach((c) => ctx.matchedIds.add(c.id));
  const onDay = day ? dayName(day) : 'several days';
  const stageName = stageNameOf(ctx, stageId) ?? 'this stage';
  const message = !stageId
    ? `Matches ${cands.length} sets on ${onDay}. Add the stage to tell them apart.`
    : day
      ? `Matches ${cands.length} sets on ${onDay} at ${stageName}. Use the export file with set_id.`
      : `Matches ${cands.length} sets on ${onDay} at ${stageName}. Add the day to tell them apart.`;
  errors.push({ field: 'stage', message });
  return undefined;
}

interface RowParts {
  row: LineupImportRowInput;
  index: number;
  names: string[];
  ids: string[];
  links: LinkChanges;
  /** undefined leaves the name alone, null clears it. */
  displayName: string | null | undefined;
  errors: RowErrors;
  warnings: string[];
}

/** Read and check the row's artist names, ids, links and display name. */
function readRowParts(ctx: Ctx, row: LineupImportRowInput, index: number): RowParts {
  const errors: RowErrors = [];
  const warnings: string[] = [];
  const names = ctx.splitNames(row.artist);
  if (names.length === 0) errors.push({ field: 'artist', message: 'Artist is empty.' });
  if (names.length > MAX_ARTISTS_PER_SET) {
    errors.push({ field: 'artist', message: `A set can have at most ${MAX_ARTISTS_PER_SET} artists.` });
  }
  const ids = parseArtistIds(row.artistId);
  if (ids.length > names.length) {
    errors.push({ field: 'artist', message: `${ids.length} artist ids for ${names.length} names. Use one id per name, with | between them.` });
  }
  const links = readLinks(row, warnings);
  const displayName = row.displayName === undefined ? undefined : sanitizeString(row.displayName, 300) || null;
  return { row, index, names, ids, links, displayName, errors, warnings };
}

function planRow(ctx: Ctx, row: LineupImportRowInput, index: number) {
  const parts = readRowParts(ctx, row, index);
  const { names, ids, links, displayName, errors, warnings } = parts;

  const day = resolveDay(ctx, row, errors);
  let stageId = resolveStage(ctx, row, errors);
  const start = readTime(row.startTime, 'startTime', errors);
  const end = readTime(row.endTime, 'endTime', errors);
  // A row with only names (and links) has nothing to schedule: it is an announced act.
  if (names.length > 0 && day === undefined && stageId === undefined && isBlank(row.setId) && isBlank(row.startTime) && isBlank(row.endTime)) {
    return planAnnouncedRow(ctx, parts);
  }
  const key = names.map(normKey).join('|');

  const match = names.length > 0 && day !== null ? findMatch(ctx, row, key, day ?? undefined, stageId ?? undefined, errors) : undefined;
  if (match) ctx.matchedIds.add(match.id);
  // An untouched export row for an act with no set yet is not a request to schedule it.
  const unplaced =
    !match &&
    errors.length === 0 &&
    names.length > 0 &&
    stageId === undefined &&
    !row.startTime?.trim() &&
    !row.endTime?.trim() &&
    ctx.unplacedKeys.has(lineupEntryKey({ artists: names.map((name) => ({ name })) }));
  if (unplaced) warnings.push('Not placed yet. Add a stage and times to schedule it.');
  if (!match && !unplaced && errors.length === 0) {
    if (!day) errors.push({ field: 'day', message: 'Day is empty.' });
    if (stageId === undefined && ctx.input.festival.stages?.length === 1) stageId = ctx.input.festival.stages[0].id;
    else if (stageId === undefined) errors.push({ field: 'stage', message: 'Stage is empty.' });
  }

  if (names.length > 0 && day !== null) {
    const dupKey = match ? `id:${match.id}` : `${key}|${day?.key ?? ''}|${stageId ?? ''}`;
    const first = ctx.firstRowOf.get(dupKey);
    if (first !== undefined) errors.push({ field: 'row', message: `Same artist, day and stage as row ${first}.` });
    else ctx.firstRowOf.set(dupKey, row.row);
  }

  const storedDay = match ? ctx.days.find((d) => d.key === match.dayKey) : undefined;
  // A set id with another day is a day move. Without the option the row is left out.
  const otherDay = match && day && day.key !== match.dayKey ? day : undefined;
  if (match && otherDay && errors.length === 0 && !ctx.input.options.moveDays) {
    return skipRow(ctx, parts, match, storedDay, otherDay);
  }
  const move = otherDay && ctx.input.options.moveDays ? otherDay : undefined;

  const { artists, resolutions } = resolveArtists(ctx, names, ids, storedArtists(match), errors, warnings);
  const dayInfo = move ?? (match ? storedDay : (day ?? undefined));
  const values = match
    ? mergedValues(ctx, match.values, names, artists, stageId ?? undefined, start, end, links, displayName)
    : newValues(ctx, names, artists, stageId ?? '', start ?? null, end ?? null, links, displayName);
  // A new set that covers an announced act takes the act's poster name, unless the row sets or clears one.
  const poster =
    !match && !unplaced && names.length > 0 && displayName === undefined
      ? (ctx.posterNames.get(lineupEntryKey({ artists: values.artists })) ?? null)
      : null;
  if (poster) values.displayName = poster;
  const changes = match ? describeChanges(ctx, match, values, links, move) : [];
  if (values.startTime && values.startTime < AFTER_MIDNIGHT_CUTOFF && dayInfo) {
    warnings.push(`Starts after midnight, so it counts as ${dayInfo.label || dayInfo.date} night.`);
  }
  if (!match && !unplaced && errors.length === 0) addNearMatchWarning(ctx, key, dayInfo, warnings, resolutions);
  if (!match && errors.length === 0 && !row.setId?.trim()) addSecondSetWarning(ctx, key, day ?? undefined, warnings);

  const status: LineupImportRowStatus =
    errors.length > 0 ? 'error' : unplaced ? 'unchanged' : !match ? 'new' : changes.length > 0 ? 'changed' : 'unchanged';
  pushPlanRow(ctx, { row, status, match, names, dayInfo, values, poster, changes, errors, warnings, resolutions });
  if (!unplaced) recordWrite(ctx, index, status, match, dayInfo, values, move);
}

/** Add the row's entry to the preview plan. */
function pushPlanRow(
  ctx: Ctx,
  r: {
    row: LineupImportRowInput;
    status: LineupImportRowStatus;
    match: ExistingSet | undefined;
    names: string[];
    dayInfo: DayInfo | undefined;
    values: SetValues;
    poster: string | null;
    changes: string[];
    errors: RowErrors;
    warnings: string[];
    resolutions: ArtistResolution[];
  },
) {
  const { row, status, match, names, dayInfo, values, poster, changes, errors, warnings, resolutions } = r;
  ctx.planRows.push({
    row: row.row,
    status,
    ...(match ? { setId: match.id } : {}),
    artists: names,
    dayLabel: dayInfo ? dayInfo.label || dayInfo.date : undefined,
    stageName: stageNameOf(ctx, values.stageId || undefined),
    startTime: values.startTime,
    endTime: values.endTime,
    ...(poster && status !== 'error' ? { displayName: poster } : {}),
    changes,
    errors,
    warnings,
    resolutions,
  });
}

/** The stored artist of a matched set that a typed name stands for. */
const storedArtists = (match: ExistingSet | undefined): ResolveOptions => ({
  findStored: (name) => match?.values.artists.find((a) => typeof a?.name === 'string' && normKey(a.name) === normKey(name)),
  renameToRow: true,
});

/** A set id row whose day is not the stored day: no write, and a warning that says why. */
function skipRow(ctx: Ctx, parts: RowParts, match: ExistingSet, storedDay: DayInfo | undefined, fileDay: DayInfo) {
  const reason = `Skipped: the file says ${dayName(fileDay)}, the stored day is ${dayName(storedDay)}. Import cannot move a set to another day. Move it in the editor, then import again.`;
  ctx.planRows.push({
    row: parts.row.row,
    status: 'unchanged',
    setId: match.id,
    artists: parts.names,
    dayLabel: dayName(storedDay) || undefined,
    stageName: stageNameOf(ctx, match.values.stageId),
    startTime: match.values.startTime,
    endTime: match.values.endTime,
    changes: [],
    errors: parts.errors,
    warnings: [reason, ...parts.warnings],
    resolutions: [],
    skipped: reason,
  });
}

/** A row with names and no day, stage or time. It adds to, or fills in, the announced lineup. */
function planAnnouncedRow(ctx: Ctx, parts: RowParts) {
  const { row, index, names, ids, links, displayName, errors, warnings } = parts;
  const key = lineupEntryKey({ artists: names.map((name) => ({ name })) });
  const match = ctx.lineupByKey.get(key);
  const dupKey = `announced|${key}`;
  const first = ctx.firstRowOf.get(dupKey);
  if (first !== undefined) errors.push({ field: 'row', message: `Same act as row ${first}.` });
  else ctx.firstRowOf.set(dupKey, row.row);

  const storedFor = (name: string) => match?.artists.find((a) => lineupNameKey(a.name) === lineupNameKey(name));
  const { artists, resolutions } = resolveArtists(ctx, names, ids, { findStored: storedFor, renameToRow: false }, errors, warnings);
  applyLinks(artists[0], links);
  const after: LineupEntryValue = match
    ? { ...match, artists, displayName: displayName !== undefined ? displayName : (match.displayName ?? null) }
    : {
        id: ctx.makeId('lu'),
        artists,
        displayName: displayName ?? null,
        tier: null,
        dayDate: null,
        status: 'announced',
        announcedAt: ctx.today,
        linkedSetIds: [],
      };
  const changes: string[] = [];
  if (match?.status === 'cancelled') {
    warnings.push('This act is cancelled in the announced lineup. Restore it in the editor.');
  }
  if (match) {
    artists.forEach((a, i) => {
      if (a.id && a.id !== storedFor(names[i]!)?.id) changes.push(`Artist ${a.name} linked to artist ${a.id}`);
    });
    changes.push(...describeLinkChanges(storedFor(names[0]!)?.links ?? {}, artists[0]?.links ?? {}, links));
    if ((match.displayName ?? null) !== after.displayName) {
      changes.push(`Display name ${match.displayName ?? 'none'} → ${after.displayName ?? 'none'}`);
    }
  } else if (errors.length === 0) {
    const near = ctx.lineup.find((e) => {
      const other = lineupEntryKey(e);
      // Length gap above 2 means distance above 2; skip the O(n*m) DP (up to 500 x 500 pairs per import).
      return Math.min(key.length, other.length) >= NEAR_MIN_KEY_LENGTH
        && Math.abs(key.length - other.length) <= 2
        && editDistance(key, other) <= 2;
    });
    if (near) {
      const text = near.artists.map((a) => a.name).join(` ${ctx.sep} `);
      warnings.push(`Did you mean ${text}?`);
      markNear(resolutions, text);
    }
  }

  const status: LineupImportRowStatus = errors.length > 0 ? 'error' : !match ? 'new' : changes.length > 0 ? 'changed' : 'unchanged';
  ctx.planRows.push({ row: row.row, status, target: 'announced', artists: names, changes, errors, warnings, resolutions });
  if (status === 'new') ctx.announcedInserts.push({ index, entry: after });
  else if (status === 'changed' && ctx.input.options.updateExisting && match) {
    ctx.announcedUpdates.push({ index, id: match.id, before: match, after });
  }
}

function newValues(
  ctx: Ctx,
  names: string[],
  artists: ArtistEntry[],
  stageId: string,
  start: string | null,
  end: string | null,
  links: LinkChanges,
  displayName: string | null | undefined,
): SetValues {
  applyLinks(artists[0], links);
  return {
    stageId,
    startTime: start,
    endTime: end,
    artist: names.join(` ${ctx.sep} `),
    artists,
    linkUrl: artists[0]?.links.spotify ?? null,
    displayName: displayName ?? null,
  };
}

/** The matched set after the row is applied. Each artist keeps its stored id, photo, genres and links by name. */
function mergedValues(
  ctx: Ctx,
  before: SetValues,
  names: string[],
  artists: ArtistEntry[],
  stageId: string | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  links: LinkChanges,
  displayName: string | null | undefined,
): SetValues {
  applyLinks(artists[0], links);
  return {
    stageId: stageId ?? before.stageId,
    startTime: start !== undefined ? start : before.startTime,
    endTime: end !== undefined ? end : before.endTime,
    artist: names.join(` ${ctx.sep} `),
    artists,
    // link_url follows the first artist's Spotify link, as a festival save does.
    linkUrl: 'spotify' in links ? (artists[0]?.links.spotify ?? null) : before.linkUrl,
    displayName: displayName !== undefined ? displayName : before.displayName,
  };
}

function describeChanges(ctx: Ctx, match: ExistingSet, after: SetValues, links: LinkChanges, move: DayInfo | undefined): string[] {
  const before = match.values;
  const changes: string[] = [];
  if (move) changes.push(`Day ${match.dayLabel || '?'} → ${dayName(move)}`);
  if (after.stageId !== before.stageId) {
    changes.push(`Stage ${stageNameOf(ctx, before.stageId) ?? '?'} → ${stageNameOf(ctx, after.stageId) ?? '?'}`);
  }
  if (after.startTime !== before.startTime) changes.push(`Start ${before.startTime ?? 'TBA'} → ${after.startTime ?? 'TBA'}`);
  if (after.endTime !== before.endTime) changes.push(`End ${before.endTime ?? 'TBA'} → ${after.endTime ?? 'TBA'}`);
  const afterNames = after.artists.map((a) => a.name);
  if (afterNames.join('|') !== match.names.join('|')) {
    changes.push(`Artist ${match.names.join(` ${ctx.sep} `)} → ${afterNames.join(` ${ctx.sep} `)}`);
  }
  after.artists.forEach((a, i) => {
    if (a.id && a.id !== before.artists[i]?.id) changes.push(`Artist ${a.name} linked to artist ${a.id}`);
  });
  changes.push(...describeLinkChanges(before.artists[0]?.links ?? {}, after.artists[0]?.links ?? {}, links, before.linkUrl));
  if (after.displayName !== before.displayName) {
    changes.push(`Display name ${before.displayName ?? 'none'} → ${after.displayName ?? 'none'}`);
  }
  return changes;
}

const NEAR_MIN_KEY_LENGTH = 4;

function addNearMatchWarning(ctx: Ctx, key: string, day: DayInfo | undefined, warnings: string[], resolutions: ArtistResolution[]) {
  if (!day) return;
  const near = ctx.existing.find((s) => s.dayKey === day.key && s.key !== key && editDistance(s.key, key) <= 2);
  if (!near) return;
  const text = near.names.join(` ${ctx.sep} `);
  warnings.push(`Did you mean ${text}?`);
  markNear(resolutions, text);
}

/** A row with no set_id and a new day matches nothing, so it adds a second set. Say so, and point at the export file. */
function addSecondSetWarning(ctx: Ctx, key: string, day: DayInfo | undefined, warnings: string[]) {
  if (!day) return;
  const otherDays = ctx.days.filter((d) => d.key !== day.key && ctx.existing.some((s) => s.key === key && s.dayKey === d.key));
  if (otherDays.length === 0) return;
  warnings.push(
    `This artist already has a set on ${otherDays.map(dayName).join(', ')}. This row adds a second set on ${dayName(day)}. Use the export file to change a day.`,
  );
}

function recordWrite(
  ctx: Ctx,
  index: number,
  status: LineupImportRowStatus,
  match: ExistingSet | undefined,
  day: DayInfo | undefined,
  values: SetValues,
  move: DayInfo | undefined,
) {
  if (status === 'error' || !day) return;
  ctx.filledDays.add(day.key);
  if (status === 'new') {
    const id = ctx.makeId('set-import');
    ctx.inserts.push({ ...values, index, id, dayKey: day.key });
    ctx.schedule.push({ rowIndex: index, dayKey: day.key, stageId: values.stageId, artist: values.artist, start: values.startTime, end: values.endTime });
    return;
  }
  if (status === 'changed' && ctx.input.options.updateExisting && match) {
    ctx.updates.push({ index, setId: match.id, before: match.values, after: values, ...(move ? { dayKey: move.key } : {}) });
  }
}

/** The schedule after the import: existing sets with accepted updates applied, plus the new sets. */
function finalSchedule(ctx: Ctx): ScheduleEntry[] {
  const updated = new Map(ctx.updates.map((u) => [u.setId, u]));
  return [
    ...ctx.existing.map((s) => {
      const u = updated.get(s.id);
      const v = u ? u.after : s.values;
      return { rowIndex: u ? u.index : null, dayKey: u?.dayKey ?? s.dayKey, stageId: v.stageId, artist: v.artist, start: v.startTime, end: v.endTime };
    }),
    ...ctx.schedule,
  ];
}

/** Odd lengths and unusual start hours on the rows an import writes. Warnings only: they never block a row. */
function addTimeWarnings(ctx: Ctx) {
  const entries = finalSchedule(ctx);
  const lateDays = new Set(
    [...new Set(entries.map((e) => e.dayKey))].filter((dayKey) =>
      dayRunsLate(entries.filter((e) => e.dayKey === dayKey).map((e) => ({ startTime: e.start }))),
    ),
  );
  for (const e of entries) {
    if (e.rowIndex === null) continue;
    const flags = setTimeFlags({ startTime: e.start, endTime: e.end }, lateDays.has(e.dayKey));
    const warnings = ctx.planRows[e.rowIndex]!.warnings;
    if (flags.lengthMinutes !== undefined) {
      warnings.push(`This set is ${formatSetLength(flags.lengthMinutes)} long. Check the start and end times.`);
    }
    if (flags.unusualStart) {
      warnings.push(`Starts at ${e.start}, but most sets that day start at 14:00 or later. Check AM and PM.`);
    }
  }
}

/** Stage overlaps on the final schedule. A pair of two untouched existing sets never blocks an import. */
function addOverlapErrors(ctx: Ctx) {
  const entries = finalSchedule(ctx).filter((e) => e.start && e.end);

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (a.rowIndex === null && b.rowIndex === null) continue;
      if (a.dayKey !== b.dayKey || a.stageId !== b.stageId || !overlaps(a, b)) continue;
      const stage = stageNameOf(ctx, a.stageId) ?? 'this stage';
      for (const [self, other] of [[a, b], [b, a]] as const) {
        if (self.rowIndex === null) continue;
        const target = ctx.planRows[self.rowIndex]!;
        target.errors.push({ field: 'startTime', message: `Overlaps "${other.artist}" on ${stage} (${other.start}–${other.end}).` });
        target.status = 'error';
      }
    }
  }
}

// Same minute math as validateFestival: an end at or before the start runs past midnight.
function overlaps(a: ScheduleEntry, b: ScheduleEntry): boolean {
  const span = (e: ScheduleEntry) => {
    const s = toMinutes(e.start!);
    let end = toMinutes(e.end!);
    if (end <= s) end += 24 * 60;
    return [s, end] as const;
  };
  const [as, ae] = span(a);
  const [bs, be] = span(b);
  return as < be && bs < ae;
}

/** The import-size limits this import would break, as messages for the plan. */
function limitProblems(ctx: Ctx, newStages: Ctx['stages'], newDays: DayInfo[]): string[] {
  const { input } = ctx;
  const { config } = input;
  const problems: string[] = [];
  if (input.rows.length > config.MAX_IMPORT_SETS) {
    problems.push(
      `This file has ${input.rows.length} rows. The limit is ${config.MAX_IMPORT_SETS}. Split the file and import it in parts.`,
    );
  }
  const stageTotal = ctx.stages.filter((s) => !s.isNew).length + newStages.length;
  if (stageTotal > config.MAX_STAGES) problems.push(`This import would make ${stageTotal} stages. The limit is ${config.MAX_STAGES}.`);
  const dayTotal = ctx.existingDayCount + newDays.length;
  if (dayTotal > config.MAX_DAYS) problems.push(`This import would make ${dayTotal} days. The limit is ${config.MAX_DAYS}.`);
  const movedTo = new Map(ctx.updates.flatMap((u) => (u.dayKey ? [[u.setId, u.dayKey] as const] : [])));
  for (const day of [...ctx.days.slice(0, ctx.existingDayCount), ...newDays]) {
    const total =
      ctx.existing.filter((s) => (movedTo.get(s.id) ?? s.dayKey) === day.key).length +
      ctx.inserts.filter((s) => s.dayKey === day.key).length;
    if (total > config.MAX_SETS_PER_DAY) {
      problems.push(`${day.label || day.date} would have ${total} sets. The limit is ${config.MAX_SETS_PER_DAY}.`);
    }
  }

  if (ctx.lineup.length + ctx.announcedInserts.length > MAX_LINEUP_ENTRIES) {
    problems.push(
      `The announced lineup would have ${ctx.lineup.length + ctx.announcedInserts.length} entries. The limit is ${MAX_LINEUP_ENTRIES}.`,
    );
  }
  return problems;
}

function finish(ctx: Ctx): { plan: LineupImportPlan; writes: LineupImportWrites } {
  const { input } = ctx;
  // Only stages and days that a written set uses are created.
  const usedStageIds = new Set([...ctx.inserts.map((s) => s.stageId), ...ctx.updates.map((u) => u.after.stageId)]);
  const newStages = ctx.stages.filter((s) => s.isNew && usedStageIds.has(s.id));
  const usedDayKeys = new Set([...ctx.inserts.map((s) => s.dayKey), ...ctx.updates.flatMap((u) => (u.dayKey ? [u.dayKey] : []))]);
  const firstNewIndex = ctx.days.slice(0, ctx.existingDayCount).reduce((max, d) => Math.max(max, (d.index ?? 0) + 1), 0);
  const newDays = ctx.days
    .slice(ctx.existingDayCount)
    .filter((d) => usedDayKeys.has(d.key))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d, i) => ({ ...d, index: firstNewIndex + i }));
  const dayIndexOf = new Map([...ctx.days.slice(0, ctx.existingDayCount), ...newDays].map((d) => [d.key, d.index!]));

  const problems = limitProblems(ctx, newStages, newDays);

  const unmatchedActs = findUnmatchedActs(ctx);
  const missingFromFile = ctx.existing
    .filter((s) => !ctx.matchedIds.has(s.id))
    .map((s) => ({ setId: s.id, artist: s.values.artist, dayLabel: s.dayLabel }));
  const count = (status: LineupImportRowStatus) => ctx.planRows.filter((r) => r.status === status).length;

  const plan: LineupImportPlan = {
    festivalName: input.festival.name,
    counts: {
      new: count('new'),
      changed: count('changed'),
      unchanged: count('unchanged'),
      error: count('error'),
      newStages: newStages.length,
      newDays: newDays.length,
      missingFromFile: missingFromFile.length,
      announced: ctx.announcedInserts.length,
      skipped: ctx.planRows.filter((r) => r.skipped).length,
      needsChoice: ctx.planRows.filter((r) => r.resolutions.some((x) => x.outcome === 'needs_choice')).length,
    },
    rows: ctx.planRows,
    newStages: newStages.map((s) => ({ name: s.name, color: s.color })),
    newDays: newDays.map((d) => ({ label: d.label, date: d.date })),
    missingFromFile,
    unmatchedActs,
    problems,
    stages: [...ctx.stages.filter((s) => !s.isNew), ...newStages].map((s) => s.name),
    days: [...ctx.days.slice(0, ctx.existingDayCount), ...newDays].map((d) => d.label || d.date),
  };
  const writes: LineupImportWrites = {
    newStages: newStages.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    newDays: newDays.map((d) => ({ dayIndex: d.index, label: d.label, date: d.date })),
    inserts: ctx.inserts.map(({ dayKey, ...s }) => ({ ...s, dayIndex: dayIndexOf.get(dayKey)! })),
    updates: ctx.updates.map(({ dayKey, ...u }) => {
      if (!dayKey) return u;
      const from = ctx.days.find((d) => d.key === ctx.existingById.get(u.setId)!.dayKey)!.index!;
      return { ...u, dayMove: { from, to: dayIndexOf.get(dayKey)! } };
    }),
    announced: { inserts: ctx.announcedInserts, updates: ctx.announcedUpdates },
    artistIds: [...ctx.lookedUpIds],
    spotifyMatched: 0,
  };
  return { plan, writes };
}

/**
 * Announced acts dated to a day this import writes to that no set covers once it is written. The cover
 * rule is the one in lib/lineup.ts: equal name-key sets, or a hand link to a set that exists.
 */
function findUnmatchedActs(ctx: Ctx): LineupImportPlan['unmatchedActs'] {
  const setKey = (artists: { name: string }[]) => lineupEntryKey({ artists });
  const updated = new Map(ctx.updates.map((u) => [u.setId, u.after]));
  const covered = new Set<string>([
    ...ctx.existing.map((s) => setKey(updated.get(s.id)?.artists ?? s.names.map((name) => ({ name })))),
    ...ctx.inserts.map((s) => setKey(s.artists)),
  ]);
  return ctx.lineup
    .filter((entry) => entry.status !== 'cancelled' && !covered.has(lineupEntryKey(entry)))
    .filter((entry) => !(entry.linkedSetIds ?? []).some((id: string) => ctx.existingById.has(id)))
    .flatMap((entry) => {
      const day = entry.dayDate ? ctx.days.find((d) => d.date === entry.dayDate) : undefined;
      if (!day || !ctx.filledDays.has(day.key)) return [];
      const name = entry.displayName || (entry.artists ?? []).map((a: any) => a.name).join(` ${ctx.sep} `);
      return [{ entryId: entry.id, name, dayLabel: day.label || day.date }];
    });
}
