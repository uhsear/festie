import React from 'react';
import type { FestivalSet, Stage } from '@festie/shared/types';
import { artistDisplayName, formatTime } from '@festie/shared/utils';

interface OtherDayMatchesProps {
  groups: Array<{ dayIndex: number; sets: FestivalSet[] }>;
  dayLabels: Record<number, string>;
  stages: Stage[];
  b2bSeparator?: string;
  onSelectDay: (dayIndex: number) => void;
}

/** Search hits on days other than the selected one. A row tap switches day and keeps the search. */
export default function OtherDayMatches({ groups, dayLabels, stages, b2bSeparator, onSelectDay }: OtherDayMatchesProps) {
  if (groups.length === 0) return null;
  return (
    <div className="w-full mx-auto max-w-[1440px] mt-4 flex flex-col gap-4" data-testid="other-day-matches">
      {groups.map(({ dayIndex, sets }) => {
        const dayLabel = dayLabels[dayIndex] ?? `Day ${dayIndex + 1}`;
        return (
          <section key={dayIndex} aria-label={`Also on ${dayLabel}`}>
            <h3 className="text-sm font-semibold text-text-secondary mb-2">{`Also on ${dayLabel}`}</h3>
            <ul className="flex flex-col gap-2">
              {sets.map((set) => {
                const artist = artistDisplayName(set, b2bSeparator);
                const stageName = stages.find((s) => s.id === set.stageId)?.name ?? set.stageName ?? 'Unknown';
                const time = set.startTime ? formatTime(set.startTime) : 'TBA';
                return (
                  <li key={set.id}>
                    <button
                      type="button"
                      aria-label={`Show ${artist} on ${dayLabel}`}
                      onClick={() => onSelectDay(dayIndex)}
                      className="min-h-[44px] w-full text-left px-4 py-2 rounded-lg bg-bg-card border border-border-light text-sm text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
                    >
                      {`${artist} · ${stageName} · ${time}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
