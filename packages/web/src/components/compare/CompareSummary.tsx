import React from 'react';
import { Link } from '@tanstack/react-router';
import {
  artistDisplayName,
  fmtZonedClock,
  formatGapLength,
  type CrewSplit,
  type CrewTogether,
  type FreeSlot,
} from '@festie/shared/utils';

interface CompareSummaryProps {
  columns: Array<{ profileId: string; name: string; isMe: boolean; color: string }>;
  freeTogether: FreeSlot[];
  split: CrewSplit[];
  together: CrewTogether[];
  timeZone: string | undefined;
}

/**
 * Colour key for the compare columns, the gaps where nobody in the crew has a
 * pick, where the crew splits up, and the sets they see together.
 */
export default function CompareSummary({ columns, freeTogether, split, together, timeZone }: CompareSummaryProps) {
  const names = (ids: string[]) =>
    ids
      .map((id) => columns.find((c) => c.profileId === id))
      .map((c) => (c?.isMe ? 'You' : (c?.name ?? 'Crew member')))
      .join(', ');

  return (
    <section className="mb-3 rounded-xl border border-glass-border bg-bg-card p-3 space-y-3">
      <ul aria-label="Crew colour key" className="flex flex-wrap gap-x-4 gap-y-1">
        {columns.map((c) => (
          <li key={c.profileId} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span
              className="inline-block h-[10px] w-[10px] rounded-full"
              style={{ background: c.color }}
              aria-hidden="true"
            />
            {c.isMe ? 'You' : c.name}
          </li>
        ))}
      </ul>

      {freeTogether.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-text-primary">Free together</h2>
          <p className="text-xs text-text-muted mt-0.5">Nobody in the crew has a pick then.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {freeTogether.map((slot) => (
              <li
                key={slot.startMs}
                className="rounded-full bg-[var(--color-overlay-2)] border border-border-light px-3 py-1 text-xs font-semibold text-text-primary"
              >
                {fmtZonedClock(slot.startMs, timeZone)} – {fmtZonedClock(slot.endMs, timeZone)} ·{' '}
                {formatGapLength(slot.minutes)}
              </li>
            ))}
          </ul>
          <Link
            to="/crew"
            search={{ tab: 'find' }}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full border border-accent-aqua/70 px-3 py-1.5 text-sm font-semibold text-text-secondary hover:border-accent-aqua hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          >
            Add meeting point
          </Link>
        </div>
      )}

      {split.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-text-primary">Split</h2>
          <p className="text-xs text-text-muted mt-0.5">The crew picked different sets at the same time.</p>
          <ul className="mt-2 space-y-2">
            {split.map((s) => (
              <li key={s.startMs} className="text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">
                  {fmtZonedClock(s.startMs, timeZone)} – {fmtZonedClock(s.endMs, timeZone)}
                </span>
                <ul className="mt-0.5">
                  {s.sides.map((side) => (
                    <li key={side.set.id}>
                      {artistDisplayName(side.set)}: {names(side.memberIds)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {together.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-text-primary">Together</h2>
          <p className="text-xs text-text-muted mt-0.5">Sets you can see as a group, with no clash.</p>
          <ul className="mt-2 space-y-1">
            {together.map((t) => (
              <li key={t.set.id} className="text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">{artistDisplayName(t.set)}</span> ·{' '}
                {fmtZonedClock(t.startMs, timeZone)} · {names(t.memberIds)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
