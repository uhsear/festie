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
 */

import { MAX_ARTISTS_PER_SET } from './constants';
import { sanitizeLinkRecord, type LineupImportRowInput } from './schemas';
import { sanitizeString } from './helpers/sanitize';
import { validateColor, validateTime } from './helpers/validation';

type ErrorField = 'artist' | 'day' | 'date' | 'stage' | 'startTime' | 'endTime' | 'link' | 'row';
export type LineupImportRowStatus = 'new' | 'changed' | 'unchanged' | 'error';

export interface LineupImportPlanRow {
  row: number;
  status: LineupImportRowStatus;
  setId?: string;
  artists: string[];
  dayLabel?: string;
  stageName?: string;
  startTime?: string | null;
  endTime?: string | null;
  changes: string[];
  errors: { field: ErrorField; message: string }[];
  warnings: string[];
}

export interface LineupImportPlan {
  festivalName: string;
  counts: {
    new: number;
    changed: number;
    unchanged: number;
    error: number;
    newStages: number;
    newDays: number;
    missingFromFile: number;
  };
  rows: LineupImportPlanRow[];
  newStages: { name: string; color: string }[];
  newDays: { label: string; date: string }[];
  missingFromFile: { setId: string; artist: string; dayLabel: string }[];
  problems: string[];
  stages: string[];
  days: string[];
}

export interface ArtistEntry {
  name: string;
  links: Record<string, string>;
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
}

export interface LineupImportWrites {
  newStages: { id: string; name: string; color: string }[];
  newDays: { dayIndex: number; label: string; date: string }[];
  inserts: (SetValues & { index: number; id: string; dayIndex: number })[];
  updates: { index: number; setId: string; before: SetValues; after: SetValues }[];
  spotifyMatched: number;
}

export interface SpotifyHit {
  spotifyUrl?: string;
  imageUrl?: string;
  genres?: string[];
}

export interface PlanInput {
  festival: any;
  rows: LineupImportRowInput[];
  options: { updateExisting: boolean; createMissing: boolean };
  config: { MAX_IMPORT_SETS: number; MAX_STAGES: number; MAX_DAYS: number; MAX_SETS_PER_DAY: number };
  /** Lower-case artist name to Spotify search hit. Fills links of new sets only. */
  spotify?: Map<string, SpotifyHit>;
  /** Id factory for new stages and sets. The default is deterministic, for previews. */
  makeId?: (prefix: string) => string;
}

const DEFAULT_STAGE_COLOR = '#6a6a88';
const AFTER_MIDNIGHT_CUTOFF = '06:00';

const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
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

/** Builds the import plan and the writes a commit would make. */
export function planLineupImport(input: PlanInput): { plan: LineupImportPlan; writes: LineupImportWrites } {
  const ctx = createContext(input);
  input.rows.forEach((row, index) => planRow(ctx, row, index));
  addOverlapErrors(ctx);
  return finish(ctx);
}

function createContext(input: PlanInput) {
  const { festival } = input;
  let counter = 0;
  const makeId = input.makeId ?? ((prefix: string) => `${prefix}-preview-${++counter}`);
  const sep = sanitizeString(festival.b2bSeparator || 'b2b', 10) || 'b2b';
  const splitRe = new RegExp(`\\s+(?:${escapeRe(sep)}|b2b)\\s+`, 'i');
  const splitNames = (raw: string) =>
    raw
      .split(splitRe)
      .map((n) => sanitizeString(n, 300))
      .filter(Boolean);

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
        },
      };
    }),
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
    existingById: new Map(existing.map((s) => [s.id, s])),
    planRows: [] as LineupImportPlanRow[],
    matchedIds: new Set<string>(),
    firstRowOf: new Map<string, number>(),
    inserts: [] as (SetValues & { index: number; id: string; dayKey: string })[],
    updates: [] as LineupImportWrites['updates'],
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
  const key = normKey(raw);
  const found = ctx.stages.find((s) => normKey(s.name) === key || s.id === raw);
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

/** Returns the clean link, null to clear it, or undefined to leave it. */
function readLink(raw: string | undefined, warnings: string[]) {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!value) return null;
  const clean = sanitizeLinkRecord({ spotify: value }).spotify;
  if (clean) return clean;
  warnings.push('Link dropped. Use an https link to Spotify, SoundCloud or another allowed site.');
  return undefined;
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
  errors.push({
    field: 'stage',
    message: `Matches ${cands.length} sets on ${day?.label || 'several days'}. Add the stage to tell them apart.`,
  });
  return undefined;
}

function planRow(ctx: Ctx, row: LineupImportRowInput, index: number) {
  const errors: RowErrors = [];
  const warnings: string[] = [];
  const names = ctx.splitNames(row.artist);
  if (names.length === 0) errors.push({ field: 'artist', message: 'Artist is empty.' });
  if (names.length > MAX_ARTISTS_PER_SET) {
    errors.push({ field: 'artist', message: `A set can have at most ${MAX_ARTISTS_PER_SET} artists.` });
  }
  const day = resolveDay(ctx, row, errors);
  let stageId = resolveStage(ctx, row, errors);
  const start = readTime(row.startTime, 'startTime', errors);
  const end = readTime(row.endTime, 'endTime', errors);
  const link = readLink(row.link, warnings);
  const key = names.map(normKey).join('|');

  const match = names.length > 0 && day !== null ? findMatch(ctx, row, key, day ?? undefined, stageId ?? undefined, errors) : undefined;
  if (match) ctx.matchedIds.add(match.id);
  if (!match && errors.length === 0) {
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

  const dayInfo = match ? ctx.days.find((d) => d.key === match.dayKey) : day ?? undefined;
  const values = match
    ? mergedValues(ctx, match.values, names, stageId ?? undefined, start, end, link)
    : newValues(ctx, names, stageId ?? '', start ?? null, end ?? null, link ?? null);
  const changes = match ? describeChanges(ctx, match, values, link) : [];
  if (values.startTime && values.startTime < AFTER_MIDNIGHT_CUTOFF && dayInfo) {
    warnings.push(`Starts after midnight, so it counts as ${dayInfo.label || dayInfo.date} night.`);
  }
  if (!match && errors.length === 0) addNearMatchWarning(ctx, key, dayInfo, warnings);

  const status: LineupImportRowStatus =
    errors.length > 0 ? 'error' : !match ? 'new' : changes.length > 0 ? 'changed' : 'unchanged';
  ctx.planRows.push({
    row: row.row,
    status,
    ...(match ? { setId: match.id } : {}),
    artists: names,
    dayLabel: dayInfo ? dayInfo.label || dayInfo.date : undefined,
    stageName: stageNameOf(ctx, values.stageId || undefined),
    startTime: values.startTime,
    endTime: values.endTime,
    changes,
    errors,
    warnings,
  });
  recordWrite(ctx, index, status, match, dayInfo, values);
}

function newValues(ctx: Ctx, names: string[], stageId: string, start: string | null, end: string | null, link: string | null): SetValues {
  const artists: ArtistEntry[] = names.map((name) => ({ name, links: {} }));
  if (link && artists[0]) artists[0].links.spotify = link;
  return { stageId, startTime: start, endTime: end, artist: names.join(` ${ctx.sep} `), artists, linkUrl: link };
}

/** The matched set after the row is applied. Each artist keeps its stored photo, genres and links by name. */
function mergedValues(
  ctx: Ctx,
  before: SetValues,
  names: string[],
  stageId: string | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  link: string | null | undefined,
): SetValues {
  const artists: ArtistEntry[] = names.map((name) => {
    const stored = before.artists.find((a) => typeof a?.name === 'string' && normKey(a.name) === normKey(name));
    return stored ? { ...stored, name, links: { ...(stored.links || {}) } } : { name, links: {} };
  });
  if (link !== undefined && artists[0]) {
    if (link) artists[0].links.spotify = link;
    else delete artists[0].links.spotify;
  }
  return {
    stageId: stageId ?? before.stageId,
    startTime: start !== undefined ? start : before.startTime,
    endTime: end !== undefined ? end : before.endTime,
    artist: names.join(` ${ctx.sep} `),
    artists,
    linkUrl: link !== undefined ? link : before.linkUrl,
  };
}

function describeChanges(ctx: Ctx, match: ExistingSet, after: SetValues, link: string | null | undefined): string[] {
  const before = match.values;
  const changes: string[] = [];
  if (after.stageId !== before.stageId) {
    changes.push(`Stage ${stageNameOf(ctx, before.stageId) ?? '?'} → ${stageNameOf(ctx, after.stageId) ?? '?'}`);
  }
  if (after.startTime !== before.startTime) changes.push(`Start ${before.startTime ?? 'TBA'} → ${after.startTime ?? 'TBA'}`);
  if (after.endTime !== before.endTime) changes.push(`End ${before.endTime ?? 'TBA'} → ${after.endTime ?? 'TBA'}`);
  const afterNames = after.artists.map((a) => a.name);
  if (afterNames.join('|') !== match.names.join('|')) {
    changes.push(`Artist ${match.names.join(` ${ctx.sep} `)} → ${afterNames.join(` ${ctx.sep} `)}`);
  }
  if (link !== undefined) {
    const old = blankToNull(before.artists[0]?.links?.spotify) ?? before.linkUrl;
    if (old !== link) changes.push(`Link ${old ?? 'none'} → ${link ?? 'none'}`);
  }
  return changes;
}

function addNearMatchWarning(ctx: Ctx, key: string, day: DayInfo | undefined, warnings: string[]) {
  if (!day) return;
  const near = ctx.existing.find((s) => s.dayKey === day.key && s.key !== key && editDistance(s.key, key) <= 2);
  if (near) warnings.push(`Did you mean ${near.names.join(` ${ctx.sep} `)}?`);
}

function recordWrite(ctx: Ctx, index: number, status: LineupImportRowStatus, match: ExistingSet | undefined, day: DayInfo | undefined, values: SetValues) {
  if (status === 'error' || !day) return;
  if (status === 'new') {
    const id = ctx.makeId('set-import');
    ctx.inserts.push({ ...values, index, id, dayKey: day.key });
    ctx.schedule.push({ rowIndex: index, dayKey: day.key, stageId: values.stageId, artist: values.artist, start: values.startTime, end: values.endTime });
    return;
  }
  if (status === 'changed' && ctx.input.options.updateExisting && match) {
    ctx.updates.push({ index, setId: match.id, before: match.values, after: values });
  }
}

/** Stage overlaps on the final schedule. A pair of two untouched existing sets never blocks an import. */
function addOverlapErrors(ctx: Ctx) {
  const updated = new Map(ctx.updates.map((u) => [u.setId, u]));
  const entries: ScheduleEntry[] = [
    ...ctx.existing.map((s) => {
      const u = updated.get(s.id);
      const v = u ? u.after : s.values;
      return { rowIndex: u ? u.index : null, dayKey: s.dayKey, stageId: v.stageId, artist: v.artist, start: v.startTime, end: v.endTime };
    }),
    ...ctx.schedule,
  ].filter((e) => e.start && e.end);

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

function finish(ctx: Ctx): { plan: LineupImportPlan; writes: LineupImportWrites } {
  const { input } = ctx;
  const { config } = input;
  const problems: string[] = [];
  if (input.rows.length > config.MAX_IMPORT_SETS) {
    problems.push(
      `This file has ${input.rows.length} rows. The limit is ${config.MAX_IMPORT_SETS}. Split the file and import it in parts.`,
    );
  }

  // Only stages and days that a written set uses are created.
  const usedStageIds = new Set([...ctx.inserts.map((s) => s.stageId), ...ctx.updates.map((u) => u.after.stageId)]);
  const newStages = ctx.stages.filter((s) => s.isNew && usedStageIds.has(s.id));
  const usedDayKeys = new Set(ctx.inserts.map((s) => s.dayKey));
  const firstNewIndex = ctx.days.slice(0, ctx.existingDayCount).reduce((max, d) => Math.max(max, (d.index ?? 0) + 1), 0);
  const newDays = ctx.days
    .slice(ctx.existingDayCount)
    .filter((d) => usedDayKeys.has(d.key))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d, i) => ({ ...d, index: firstNewIndex + i }));
  const dayIndexOf = new Map([...ctx.days.slice(0, ctx.existingDayCount), ...newDays].map((d) => [d.key, d.index!]));

  const stageTotal = ctx.stages.filter((s) => !s.isNew).length + newStages.length;
  if (stageTotal > config.MAX_STAGES) problems.push(`This import would make ${stageTotal} stages. The limit is ${config.MAX_STAGES}.`);
  const dayTotal = ctx.existingDayCount + newDays.length;
  if (dayTotal > config.MAX_DAYS) problems.push(`This import would make ${dayTotal} days. The limit is ${config.MAX_DAYS}.`);
  for (const day of [...ctx.days.slice(0, ctx.existingDayCount), ...newDays]) {
    const total = ctx.existing.filter((s) => s.dayKey === day.key).length + ctx.inserts.filter((s) => s.dayKey === day.key).length;
    if (total > config.MAX_SETS_PER_DAY) {
      problems.push(`${day.label || day.date} would have ${total} sets. The limit is ${config.MAX_SETS_PER_DAY}.`);
    }
  }

  const spotifyMatched = fillSpotify(ctx);
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
    },
    rows: ctx.planRows,
    newStages: newStages.map((s) => ({ name: s.name, color: s.color })),
    newDays: newDays.map((d) => ({ label: d.label, date: d.date })),
    missingFromFile,
    problems,
    stages: [...ctx.stages.filter((s) => !s.isNew), ...newStages].map((s) => s.name),
    days: [...ctx.days.slice(0, ctx.existingDayCount), ...newDays].map((d) => d.label || d.date),
  };
  const writes: LineupImportWrites = {
    newStages: newStages.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    newDays: newDays.map((d) => ({ dayIndex: d.index, label: d.label, date: d.date })),
    inserts: ctx.inserts.map(({ dayKey, ...s }) => ({ ...s, dayIndex: dayIndexOf.get(dayKey)! })),
    updates: ctx.updates,
    spotifyMatched,
  };
  return { plan, writes };
}

/** Fills Spotify link, photo and genres of new sets' artists that have no link. */
function fillSpotify(ctx: Ctx): number {
  const { spotify } = ctx.input;
  if (!spotify) return 0;
  let matched = 0;
  for (const set of ctx.inserts) {
    for (const artist of set.artists) {
      const hit = artist.links.spotify ? undefined : spotify.get(artist.name.toLowerCase());
      if (!hit?.spotifyUrl) continue;
      artist.links.spotify = hit.spotifyUrl;
      if (hit.imageUrl) artist.photo = hit.imageUrl;
      if (hit.genres?.length) artist.genres = hit.genres;
      matched++;
    }
    set.linkUrl = set.artists[0]?.links.spotify ?? set.linkUrl;
  }
  return matched;
}

/** Names of the artists of new sets that have no link: the Spotify search list. */
export function artistsNeedingLinks(writes: LineupImportWrites): string[] {
  return [...new Set(writes.inserts.flatMap((s) => s.artists.filter((a) => !a.links.spotify).map((a) => a.name)))];
}
