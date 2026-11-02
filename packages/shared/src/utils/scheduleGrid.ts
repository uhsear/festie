import type { FestivalSet, Priority, Stage } from '../types/domain';
import type { ConflictGroup } from './pickConflicts';
import { artistDisplayName } from './format';
import { clashesWith } from '../constants/copy';

/** Zoom levels in px per minute, smallest first. Index 1 is the phone default, 2 the wide default. */
export const GRID_ZOOM_LEVELS = [1.4, 1.9, 2.4] as const;

export function defaultZoomIndex(viewportW: number): number {
  return viewportW < 640 ? 1 : 2;
}

/** Column width that shows two stages next to the time gutter. */
export function twoUpColumnWidth(viewportW: number, gutterW: number, min = 120, max = 220): number {
  return Math.min(max, Math.max(min, Math.floor((viewportW - gutterW) / 2)));
}

/** Hold-to-pick order: none → maybe → want-to-see → must → none. */
export function nextPickInCycle(current: Priority | null | undefined): Priority | null {
  if (current === 'maybe') return 'want-to-see';
  if (current === 'want-to-see') return 'must';
  if (current === 'must') return null;
  return 'maybe';
}

export interface ClashSegment { from: number; to: number } // fractions 0..1 of the set's own length
export interface ClashMark {
  segments: ClashSegment[]; // sorted, merged, from < to
  withIds: string[];        // ids of the picks this set overlaps (pairwise, not the whole group)
  text: string;             // clashesWith(labels), e.g. "Clashes with Fisher · Main Stage"
}

/** label(set) is the partner's display text; the hook passes "Artist · Stage". */
export function buildClashMarks(
  groups: ConflictGroup[],
  label: (set: FestivalSet) => string,
): Map<string, ClashMark> {
  const marks = new Map<string, ClashMark>();
  for (const group of groups) {
    for (const p of group.picks) {
      const length = p.endMs - p.startMs;
      if (length <= 0) continue;
      const raw: ClashSegment[] = [];
      const partners: ConflictGroup['picks'] = [];
      for (const q of group.picks) {
        if (q === p) continue;
        const from = Math.max(p.startMs, q.startMs);
        const to = Math.min(p.endMs, q.endMs);
        if (to <= from) continue;
        raw.push({ from: (from - p.startMs) / length, to: (to - p.startMs) / length });
        partners.push(q);
      }
      if (!partners.length) continue;
      raw.sort((a, b) => a.from - b.from);
      const segments: ClashSegment[] = [];
      for (const seg of raw) {
        const last = segments[segments.length - 1];
        if (last && seg.from <= last.to) last.to = Math.max(last.to, seg.to);
        else segments.push({ ...seg });
      }
      marks.set(p.set.id, {
        segments,
        withIds: partners.map((q) => q.set.id),
        text: clashesWith(partners.map((q) => label(q.set))),
      });
    }
  }
  return marks;
}

function earliestOverlapStart(group: ConflictGroup): number {
  let best = Infinity;
  for (let i = 0; i < group.picks.length; i++) {
    for (let j = i + 1; j < group.picks.length; j++) {
      const a = group.picks[i]!;
      const b = group.picks[j]!;
      if (Math.min(a.endMs, b.endMs) <= Math.max(a.startMs, b.startMs)) continue;
      best = Math.min(best, Math.max(a.startMs, b.startMs));
    }
  }
  return best;
}

/** The clash to show first: the group with the earliest overlap start, then its earliest pick on a visible stage. */
export function pickClashTarget(
  groups: ConflictGroup[],
  visibleStageIds: ReadonlySet<string>,
): { set: FestivalSet; visible: boolean } | null {
  let first: ConflictGroup | null = null;
  let firstStart = Infinity;
  for (const g of groups) {
    const start = earliestOverlapStart(g);
    if (start < firstStart) { first = g; firstStart = start; }
  }
  if (!first) return null;
  const sorted = [...first.picks].sort((a, b) => a.startMs - b.startMs);
  const shown = sorted.find((p) => visibleStageIds.has(p.set.stageId));
  if (shown) return { set: shown.set, visible: true };
  return { set: sorted[0]!.set, visible: false };
}

export interface UntimedStageGroup { stage: Stage | null; sets: FestivalSet[] }

/** Stage order from `stages`; sets sorted by display name; sets with an unknown stage last (stage: null). Empty groups left out. */
export function groupUntimedByStage(
  sets: FestivalSet[],
  stages: Stage[],
  b2bSeparator?: string,
): UntimedStageGroup[] {
  const name = (s: FestivalSet) => artistDisplayName(s, b2bSeparator).toLowerCase();
  const byName = (a: FestivalSet, b: FestivalSet) => name(a).localeCompare(name(b));
  const known = new Set(stages.map((s) => s.id));
  const groups: UntimedStageGroup[] = stages.map((stage) => ({
    stage,
    sets: sets.filter((s) => s.stageId === stage.id).sort(byName),
  }));
  groups.push({ stage: null, sets: sets.filter((s) => !known.has(s.stageId)).sort(byName) });
  return groups.filter((g) => g.sets.length > 0);
}

export type GridNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
export interface GridNavCell { id: string; col: number; start: number } // start in minutes, as placed

/** Up/Down: previous/next by start in the same column. Left/Right: nearest non-empty column that way,
 *  the cell with the closest start (tie: earlier). Home/End: first/last in the column. Null at an edge. */
export function gridNeighbour(cells: GridNavCell[], fromId: string, key: GridNavKey): string | null {
  const from = cells.find((c) => c.id === fromId);
  if (!from) return null;
  const column = cells.filter((c) => c.col === from.col).sort((a, b) => a.start - b.start);
  const at = column.indexOf(from);
  if (key === 'ArrowUp') return column[at - 1]?.id ?? null;
  if (key === 'ArrowDown') return column[at + 1]?.id ?? null;
  if (key === 'Home' || key === 'End') {
    const target = key === 'Home' ? column[0]! : column[column.length - 1]!;
    return target === from ? null : target.id;
  }
  const dir = key === 'ArrowRight' ? 1 : -1;
  const cols = cells.map((c) => c.col).filter((c) => (c - from.col) * dir > 0);
  if (!cols.length) return null;
  const nearest = dir > 0 ? Math.min(...cols) : Math.max(...cols);
  const best = cells
    .filter((c) => c.col === nearest)
    .sort((a, b) => Math.abs(a.start - from.start) - Math.abs(b.start - from.start) || a.start - b.start)[0]!;
  return best.id;
}
