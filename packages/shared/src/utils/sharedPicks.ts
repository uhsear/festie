import type { FestivalSet, Priority } from '../types/domain';
import type { SharedPicksPayload } from '../services/sharing';
import { artistDisplayName, formatTime } from './format';
import { byStartTime, formatDayChip } from './scheduleFormat';
import { FESTIE_ORIGIN } from './links';

const TOKEN = /^[A-Za-z0-9_-]{1,100}$/;
const VANITY = /^u\/[A-Za-z0-9_-]{1,30}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const RANK: Record<Priority, number> = { must: 3, 'want-to-see': 2, maybe: 1 };

/** Validates the `from` value of a friend-picks link: a share token, or `u/<username>`. */
export function parseSharedPicksRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (VANITY.test(v)) return `u/${v.slice(2).toLowerCase()}`;
  return TOKEN.test(v) ? v : null;
}

export function buildFriendPicksUrl(ref: string, opts?: { origin?: string; add?: boolean }): string {
  return `${opts?.origin ?? FESTIE_ORIGIN}/friend-picks?from=${encodeURIComponent(ref)}${opts?.add ? '#add' : ''}`;
}

export function buildFriendPicksAppLink(ref: string): string {
  return `festie://friend-picks?from=${encodeURIComponent(ref)}`;
}

export type CompareBucket = 'both' | 'theirs' | 'mine';
export interface ComparedSet {
  setId: string;
  artist: string;
  stage: string;
  stageColor: string | null;
  dayIndex: number;
  dayLabel: string;
  time: string;
  theirs?: Priority;
  mine?: Priority;
  bucket: CompareBucket;
  addable: boolean;
}
export interface SharedPicksComparison {
  days: Array<{ dayIndex: number; label: string; rows: ComparedSet[] }>;
  counts: { both: number; theirsOnly: number; mineOnly: number };
  missing: number;
}

export function compareSharedPicks(
  payload: SharedPicksPayload,
  mine: Record<string, Priority> | undefined,
): SharedPicksComparison {
  const theirs = payload.picks;
  const stages = new Map(payload.festival.stages.map((s) => [s.id, s]));
  const sep = payload.festival.b2bSeparator ?? undefined;
  const counts = { both: 0, theirsOnly: 0, mineOnly: 0 };
  const seen = new Set<string>();
  const days: SharedPicksComparison['days'] = [];

  payload.festival.days.forEach((day, dayIndex) => {
    const label = formatDayChip({ date: day.date ?? '', label: day.label }).label;
    const entries: Array<{ set: FestivalSet; row: ComparedSet }> = [];
    for (const set of day.sets) {
      const t = theirs[set.id];
      const m = mine?.[set.id];
      if (!t && !m) continue;
      seen.add(set.id);
      const bucket: CompareBucket = t && m ? 'both' : t ? 'theirs' : 'mine';
      if (bucket === 'both') counts.both++;
      else if (bucket === 'theirs') counts.theirsOnly++;
      else counts.mineOnly++;
      const stage = stages.get(set.stageId);
      entries.push({
        set,
        row: {
          setId: set.id,
          artist: artistDisplayName(set, sep),
          stage: stage?.name ?? '',
          stageColor: stage?.color && COLOR.test(stage.color) ? stage.color : null,
          dayIndex,
          dayLabel: label,
          time: set.startTime ? formatTime(set.startTime) : 'TBA',
          theirs: t,
          mine: m,
          bucket,
          addable: !!t && (!m || RANK[m] < RANK[t]),
        },
      });
    }
    if (!entries.length) return;
    entries.sort((a, b) => byStartTime(a.set, b.set));
    days.push({ dayIndex, label, rows: entries.map((e) => e.row) });
  });

  const missing = Object.keys(theirs).filter((id) => !seen.has(id)).length;
  return { days, counts, missing };
}

export function planSharedPicksAdd(
  comparison: SharedPicksComparison,
  selected: ReadonlySet<string>,
): { byPriority: Partial<Record<Priority, string[]>>; previous: Record<string, Priority | undefined>; total: number } {
  const byPriority: Partial<Record<Priority, string[]>> = {};
  const previous: Record<string, Priority | undefined> = {};
  let total = 0;
  for (const day of comparison.days) {
    for (const row of day.rows) {
      if (!row.addable || !row.theirs || !selected.has(row.setId)) continue;
      (byPriority[row.theirs] ??= []).push(row.setId);
      previous[row.setId] = row.mine;
      total++;
    }
  }
  return { byPriority, previous, total };
}
