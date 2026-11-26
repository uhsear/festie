import { useState } from 'react';
import { PRIORITY_LABELS, INTRO_LINEUP_COPY } from '@festie/shared/constants';
import {
  INTRO_INITIAL_PICKS,
  INTRO_LINEUP,
  countIntroPicks,
  cycleIntroPick,
  findIntroClash,
} from '@festie/shared/utils';
import type { IntroPicks } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import PriorityIcon from '../ui/PriorityIcon';

const PRIORITY_COLOR: Record<Priority, string> = {
  must: 'var(--color-priority-must)',
  'want-to-see': 'var(--color-priority-want)',
  maybe: 'var(--color-priority-maybe)',
};

/** A scripted miniature Friday card. Tapping a set cycles its priority; overlapping picks draw one clash line. */
export default function IntroLineup() {
  const [picks, setPicks] = useState<IntroPicks>(INTRO_INITIAL_PICKS);
  const clash = findIntroClash(picks);

  return (
    <div className="w-full max-w-xs rounded-xl border border-border bg-bg-secondary p-4 text-left">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-base font-bold text-text-primary">{INTRO_LINEUP_COPY.day}</span>
        <span className="rounded-full border border-border px-3 py-0.5 text-xs font-semibold text-accent-aqua">
          {INTRO_LINEUP_COPY.picks(countIntroPicks(picks))}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {INTRO_LINEUP.map((set) => {
          const pick = picks[set.id] ?? null;
          return (
            <li key={set.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-lg bg-bg-card px-3 text-left cursor-pointer"
                onClick={() => setPicks((p) => ({ ...p, [set.id]: cycleIntroPick(p[set.id] ?? null) }))}
              >
                <span className="flex-1 text-sm font-semibold text-text-primary">{set.artist}</span>
                <span className="text-xs text-text-muted tabular-nums">{set.time}</span>
                <span
                  className="inline-flex w-28 items-center gap-1 text-xs font-semibold"
                  style={{ color: pick ? PRIORITY_COLOR[pick] : 'var(--color-text-muted)' }}
                >
                  {pick ? <PriorityIcon priority={pick} className="w-4 h-4" filled /> : null}
                  {pick ? PRIORITY_LABELS[pick] : INTRO_LINEUP_COPY.unpicked}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="mt-3 min-h-5 text-xs font-semibold text-[var(--color-clash)]">
        {clash ? INTRO_LINEUP_COPY.clash(clash[0].artist, clash[1].artist) : null}
      </p>
      <p className="mt-1 text-xs text-text-muted">{INTRO_LINEUP_COPY.hint}</p>
    </div>
  );
}
