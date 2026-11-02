import { festivalStartMinutes, startsAfterMidnight } from './setStatus';
import { timeAgo } from './timeAgo';

// FestivalIssueTarget, FestivalIssue and ChecklistItem mirror lib/helpers/validation.ts (server).
export interface FestivalIssueTarget {
  kind: 'festival' | 'stage' | 'day' | 'set';
  field?: 'name' | 'color' | 'id' | 'label' | 'date' | 'artist' | 'stageId' | 'startTime' | 'endTime' | 'sets';
  stageId?: string;
  stageIndex?: number;
  dayIndex?: number;
  setId?: string;
  setIndex?: number;
  relatedSetId?: string;
}
export interface FestivalIssue {
  code: string;
  message: string;
  target: FestivalIssueTarget;
}
export interface ChecklistItem {
  key: 'timeZone' | 'stages' | 'days' | 'sets' | 'errors' | 'pins' | 'times' | 'overlaps';
  status: 'done' | 'todo' | 'warn';
  label: string;
}
export interface DeleteImpact {
  profiles: number;
  crews: number;
  picks: number;
}
export type EditableSet = {
  id: string;
  artist?: string;
  artists?: { name: string }[];
  stageId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  linkUrl?: string | null;
};
export type EditableFestival = {
  name?: string;
  location?: string;
  timeZone?: string | null;
  b2bSeparator?: string;
  stages?: { id: string; name?: string; color?: string }[];
  days?: { label?: string; date?: string; sets?: EditableSet[] }[];
};

const HHMM = /^(\d{1,2}):(\d{2})$/;

function isValidTime(t?: string | null): t is string {
  const m = t ? HHMM.exec(t) : null;
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

export function issueKey(t: FestivalIssueTarget): string {
  switch (t.kind) {
    case 'festival':
      return `festival:${t.field}`;
    case 'stage':
      return t.stageId ? `stage:${t.stageId}` : `stage#${t.stageIndex}`;
    case 'day':
      return `day:${t.dayIndex}`;
    case 'set':
      return t.setId ? `set:${t.setId}` : `set#${t.dayIndex}#${t.setIndex}`;
  }
}

export function groupIssues(issues: FestivalIssue[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (key: string, message: string) => {
    const list = out.get(key);
    if (list) list.push(message);
    else out.set(key, [message]);
  };
  for (const issue of issues) {
    add(issueKey(issue.target), issue.message);
    if (issue.code === 'stage_overlap' && issue.target.relatedSetId) {
      add(`set:${issue.target.relatedSetId}`, issue.message);
    }
  }
  return out;
}

const LAST = Number.MAX_SAFE_INTEGER;

export function sortLineup<T extends EditableSet>(sets: T[], stages: { id: string }[]): T[] {
  const stageRank = (s: T) => {
    const i = s.stageId ? stages.findIndex((st) => st.id === s.stageId) : -1;
    return i < 0 ? LAST : i;
  };
  const startRank = (s: T) => (isValidTime(s.startTime) ? festivalStartMinutes(s.startTime) : LAST);
  const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
  return [...sets].sort(
    (a, b) =>
      cmp(stageRank(a), stageRank(b)) ||
      cmp(startRank(a), startRank(b)) ||
      (a.artist ?? '').toLowerCase().localeCompare((b.artist ?? '').toLowerCase()),
  );
}

export function filterLineup<T extends EditableSet>(
  sets: T[],
  stages: { id: string; name?: string }[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return sets;
  const has = (v?: string | null) => !!v && v.toLowerCase().includes(q);
  return sets.filter((s) => {
    const stageName = stages.find((st) => st.id === s.stageId)?.name;
    return has(s.artist) || (s.artists ?? []).some((a) => has(a.name)) || has(stageName);
  });
}

export function pickShiftTargets(sets: EditableSet[], opts: { stageId?: string; fromTime?: string }): string[] {
  const from = isValidTime(opts.fromTime) ? festivalStartMinutes(opts.fromTime) : null;
  return sets
    .filter((s) => {
      if (!isValidTime(s.startTime)) return false;
      if (opts.stageId && s.stageId !== opts.stageId) return false;
      return from === null || festivalStartMinutes(s.startTime) >= from;
    })
    .map((s) => s.id);
}

function shiftTime(t: string, minutes: number): string {
  const [hh, mm] = t.split(':').map(Number) as [number, number];
  const total = (((hh * 60 + mm + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function shiftSetTimes<T extends EditableSet>(
  sets: T[],
  ids: ReadonlyArray<string>,
  minutes: number,
): { sets: T[]; shifted: number; skipped: number; crossedDayStart: number } {
  if (!Number.isInteger(minutes) || minutes === 0 || minutes < -720 || minutes > 720) {
    throw new RangeError('Shift must be a whole number of minutes between -720 and 720.');
  }
  const wanted = new Set(ids);
  let shifted = 0;
  let skipped = 0;
  let crossedDayStart = 0;
  const out = sets.map((s) => {
    if (!wanted.has(s.id)) return s;
    if (!isValidTime(s.startTime)) {
      skipped++;
      return s;
    }
    const startTime = shiftTime(s.startTime, minutes);
    const endTime = isValidTime(s.endTime) ? shiftTime(s.endTime, minutes) : s.endTime;
    shifted++;
    if (startsAfterMidnight(s.startTime) !== startsAfterMidnight(startTime)) crossedDayStart++;
    return { ...s, startTime, endTime };
  });
  return { sets: out, shifted, skipped, crossedDayStart };
}

const normTime = (t?: string | null) => (!t || t === 'TBA' ? '' : t);
const norm = (v?: string | null) => v ?? '';

function setSignature(s: EditableSet, dayIndex: number): string {
  return JSON.stringify([
    norm(s.artist),
    (s.artists ?? []).map((a) => a.name),
    norm(s.stageId),
    normTime(s.startTime),
    normTime(s.endTime),
    norm(s.linkUrl),
    dayIndex,
  ]);
}

export function countFestivalChanges(
  before: EditableFestival | null,
  after: EditableFestival,
): { total: number; changedSetIds: Set<string>; newSetIds: Set<string> } {
  const a = before ?? {};
  let total = 0;
  for (const k of ['name', 'location', 'timeZone', 'b2bSeparator'] as const) {
    if (norm(a[k]) !== norm(after[k])) total++;
  }

  const stagesBefore = new Map((a.stages ?? []).map((s) => [s.id, s]));
  const stagesAfter = new Map((after.stages ?? []).map((s) => [s.id, s]));
  for (const [id, s] of stagesAfter) {
    const old = stagesBefore.get(id);
    if (!old || norm(old.name) !== norm(s.name) || norm(old.color) !== norm(s.color)) total++;
  }
  for (const id of stagesBefore.keys()) if (!stagesAfter.has(id)) total++;

  const daysBefore = a.days ?? [];
  const daysAfter = after.days ?? [];
  total += Math.abs(daysBefore.length - daysAfter.length);
  for (let i = 0; i < Math.min(daysBefore.length, daysAfter.length); i++) {
    const [x, y] = [daysBefore[i]!, daysAfter[i]!];
    if (norm(x.label) !== norm(y.label) || norm(x.date) !== norm(y.date)) total++;
  }

  const setsBefore = new Map<string, string>();
  daysBefore.forEach((d, i) => (d.sets ?? []).forEach((s) => setsBefore.set(s.id, setSignature(s, i))));
  const changedSetIds = new Set<string>();
  const newSetIds = new Set<string>();
  const seen = new Set<string>();
  daysAfter.forEach((d, i) =>
    (d.sets ?? []).forEach((s) => {
      seen.add(s.id);
      const old = setsBefore.get(s.id);
      if (old === undefined) newSetIds.add(s.id);
      else if (old !== setSignature(s, i)) changedSetIds.add(s.id);
    }),
  );
  for (const id of setsBefore.keys()) if (!seen.has(id)) total++;
  total += newSetIds.size + changedSetIds.size;
  return { total, changedSetIds, newSetIds };
}

export function festivalStatusLine(
  f: { publishedAt?: string | null; updatedAt?: string; updatedByUsername?: string | null },
  now: number = Date.now(),
): { state: 'draft' | 'published'; chip: 'Draft' | 'Published'; edited: string } {
  const published = !!f.publishedAt;
  let edited = '';
  const ms = f.updatedAt ? Date.parse(f.updatedAt) : NaN;
  if (!Number.isNaN(ms)) {
    // timeAgo reads Date.now(); shift the stamp so a caller-supplied `now` gives the same age.
    const ago = timeAgo(ms + (Date.now() - now));
    edited = f.updatedByUsername ? `Edited ${ago} by ${f.updatedByUsername}` : `Edited ${ago}`;
  }
  return { state: published ? 'published' : 'draft', chip: published ? 'Published' : 'Draft', edited };
}

export function describeDeleteImpact(impact: DeleteImpact | null): string {
  if (!impact) return 'People who joined this festival lose access until you restore it from Archived.';
  if (impact.profiles === 0 && impact.crews === 0) {
    return 'Nobody has joined this festival yet. You can restore it later from Archived.';
  }
  const p = impact.profiles === 1 ? '1 person' : `${impact.profiles} people`;
  const c =
    impact.crews === 0 ? 'no crews use it' : impact.crews === 1 ? '1 crew uses it' : `${impact.crews} crews use it`;
  return `${p} joined this festival and ${c}. They lose access until you restore it from Archived. Their picks are kept.`;
}

export function describeShiftResult(
  r: { shifted: number; skipped: number; crossedDayStart: number },
  minutes: number,
): string {
  let msg = `Shifted ${r.shifted} set(s) by ${minutes > 0 ? '+' : ''}${minutes} min.`;
  if (r.skipped > 0) msg += ` ${r.skipped} had no time and were skipped.`;
  if (r.crossedDayStart > 0) msg += ` ${r.crossedDayStart} crossed 6 AM. Check which night they belong to.`;
  return msg;
}

export function isPublishBlocked(checklist: ChecklistItem[]): boolean {
  return checklist.some((i) => i.status === 'todo');
}
