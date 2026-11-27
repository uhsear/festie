import type { Priority } from '../types';

export interface IntroLineupSet {
  id: string;
  artist: string;
  /** Display time, e.g. "8:30". */
  time: string;
  /** Minutes after 12:00 pm, used only to find the overlap. */
  startMin: number;
  endMin: number;
}

/** Made-up sets: the first two overlap, so picking both draws the clash line. */
export const INTRO_LINEUP: readonly IntroLineupSet[] = [
  { id: 'a', artist: 'Nova Drift', time: '8:30', startMin: 510, endMin: 570 },
  { id: 'b', artist: 'Low Tide Club', time: '9:15', startMin: 555, endMin: 615 },
  { id: 'c', artist: 'Paper Lanterns', time: '11:00', startMin: 660, endMin: 720 },
];

export type IntroPicks = Record<string, Priority | null>;

export const INTRO_INITIAL_PICKS: IntroPicks = { a: 'must', b: null, c: 'maybe' };

const CYCLE: (Priority | null)[] = [null, 'must', 'want-to-see', 'maybe'];

/** none -> must -> want-to-see -> maybe -> none. */
export function cycleIntroPick(current: Priority | null): Priority | null {
  return CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length] ?? null;
}

export function countIntroPicks(picks: IntroPicks): number {
  return Object.values(picks).filter(Boolean).length;
}

/** The first pair of picked sets that overlap in time, or null. */
export function findIntroClash(picks: IntroPicks): [IntroLineupSet, IntroLineupSet] | null {
  const picked = INTRO_LINEUP.filter((s) => picks[s.id]);
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i]!;
      const b = picked[j]!;
      if (a.startMin < b.endMin && b.startMin < a.endMin) return [a, b];
    }
  }
  return null;
}
