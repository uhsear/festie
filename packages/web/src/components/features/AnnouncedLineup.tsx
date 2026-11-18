import React, { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import type { Festival, FestivalSet, LineupEntry, Stage } from '@festie/shared/types';
import {
  groupLineupAlphabetically,
  groupLineupByTier,
  lineupCoveringSets,
  lineupEntryBadge,
  lineupEntryName,
  lineupSetWhen,
  searchLineupEntries,
  selectLineupEntries,
} from '@festie/shared/utils';
import type { AnnouncedLineupModel } from '../../hooks/useAnnouncedLineup';
import { useNow } from '../../hooks/useSetStatus';
import { cn } from '../../lib/utils';

type LineupView = 'poster' | 'az';

const VIEW_KEY = 'festie.lineupView';
const VIEWS: { key: LineupView; label: string }[] = [
  { key: 'poster', label: 'Poster' },
  { key: 'az', label: 'A-Z' },
];

function readView(): LineupView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'az' ? 'az' : 'poster';
  } catch {
    // Storage can be blocked (private mode); the view then lasts for this visit only.
    return 'poster';
  }
}

function writeView(view: LineupView) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Same as readView: a blocked store only loses the remembered choice.
  }
}

// Tier 1 is the top line of the poster, so it gets the largest type.
const TIER_TEXT: Record<number, string> = {
  1: 'text-xl font-bold',
  2: 'text-lg font-semibold',
};
const tierText = (tier: number | null) => (tier !== null && TIER_TEXT[tier]) || 'text-base font-medium';

const pillClass = 'rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary';
const buttonClass =
  'rounded-full px-3 min-h-11 text-[length:var(--font-size-14)] font-semibold cursor-pointer ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua ';
const chipClass = (active: boolean) =>
  buttonClass + (active ? 'bg-accent-aqua text-[var(--text-on-light-accent)]' : 'bg-transparent text-text-secondary hover:text-text-primary');

/** What a row needs to describe an act, read once by the component instead of once per row. */
interface RowContext {
  cover: AnnouncedLineupModel['cover'];
  days: AnnouncedLineupModel['days'];
  sets: FestivalSet[];
  stages: Stage[];
  festival: Festival | null;
  nowMs: number;
}

/** One act: the poster name, its badges and, for a scheduled act, where it plays. */
function LineupRow({ entry, textClass, ctx }: { entry: LineupEntry; textClass: string; ctx: RowContext }) {
  const entryCover = ctx.cover[entry.id];
  if (!entryCover) return null;

  const name = lineupEntryName(entry, ctx.festival?.b2bSeparator);
  const badges = lineupEntryBadge(entry, entryCover, ctx.days, ctx.festival?.publishedAt, ctx.nowMs);
  const first = entryCover.state === 'scheduled' ? lineupCoveringSets(entryCover, ctx.sets)[0] : undefined;
  const nameNode = (
    <span className={cn(textClass, entryCover.state === 'cancelled' && 'line-through text-text-muted')}>{name}</span>
  );

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
      {first ? (
        <Link
          to="/set/$setId"
          params={{ setId: first.id }}
          className="min-h-11 inline-flex flex-wrap items-baseline gap-x-2 text-text-primary"
        >
          {nameNode}
          <span className="text-sm text-text-secondary">{lineupSetWhen(first, ctx.days, ctx.stages)}</span>
        </Link>
      ) : (
        nameNode
      )}
      {badges.map((badge) => (
        <span key={badge.kind} className={cn(pillClass, badge.kind === 'new' && 'border-accent-aqua text-accent-aqua')}>
          {badge.text}
        </span>
      ))}
    </li>
  );
}

function Rows({ entries, textClass, ctx }: { entries: LineupEntry[]; textClass: string; ctx: RowContext }) {
  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <LineupRow key={entry.id} entry={entry} textClass={textClass} ctx={ctx} />
      ))}
    </ul>
  );
}

/**
 * The announced lineup: acts the organizer has named before, or without, set times. Shows above the
 * day cards and below the grid. A search replaces it with the acts that match. The route computes
 * the model once (useAnnouncedLineup) because it also decides whether this block replaces an empty state.
 */
export default function AnnouncedLineup({ model, className }: { model: AnnouncedLineupModel; className?: string }) {
  const festival = useFestivalStore((s) => s.currentFestival);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const nowMs = useNow();
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const [view, setView] = useState<LineupView>(readView);
  const [full, setFull] = useState(false);

  const query = (searchQuery ?? '').trim();
  const matches = useMemo(
    () => (query ? searchLineupEntries(model.lineup, model.cover, query) : []),
    [model.lineup, model.cover, query],
  );
  const selection = useMemo(
    () =>
      full
        ? selectLineupEntries(model.lineup, model.cover, sets ?? [], { dayIndex: selectedDay, fullLineup: true })
        : model.selection,
    [full, model.lineup, model.cover, model.selection, sets, selectedDay],
  );

  if (!model.visible) return null;

  // `model.days` carries each day's sets and is what lineupSetWhen reads day labels from.
  const ctx: RowContext = { cover: model.cover, days: model.days, sets: sets ?? [], stages: stages ?? [], festival, nowMs };

  if (query) {
    if (matches.length === 0) return null;
    return (
      <section aria-label="Announced acts" className={cn('w-full mx-auto max-w-[1440px] mt-4', className)}>
        <h2 className="text-sm font-semibold text-text-secondary mb-2">Announced acts</h2>
        <Rows entries={matches} textClass="text-base font-medium" ctx={ctx} />
      </section>
    );
  }

  const { summary } = model;
  const nothingToList = selection.active.length === 0 && selection.cancelled.length === 0;
  const changeView = (next: LineupView) => {
    setView(next);
    writeView(next);
  };

  return (
    <section
      aria-labelledby="announced-lineup-heading"
      className={cn(
        'w-full mx-auto max-w-[1440px] mb-[var(--space-4)] rounded-xl border border-border bg-bg-card px-4 py-3',
        className,
      )}
    >
      <h2 id="announced-lineup-heading" className="text-sm font-semibold text-text-primary">
        Announced lineup
      </h2>
      <p className="text-sm text-text-secondary">{summary.header}</p>
      {model.noSets && <p className="text-sm text-text-secondary">Set times aren&apos;t out yet.</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 rounded-full bg-bg-secondary" role="group" aria-label="Lineup view">
          {VIEWS.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => changeView(key)} className={chipClass(view === key)}>
              {label}
            </button>
          ))}
        </div>
        {summary.scheduled > 0 && (
          <button
            type="button"
            aria-pressed={full}
            onClick={() => setFull((on) => !on)}
            className={cn(chipClass(full), 'border border-border')}
          >
            Full lineup
          </button>
        )}
      </div>

      {nothingToList ? (
        <p className="mt-3 text-sm text-text-secondary">
          {summary.scheduled > 0
            ? 'Every announced act for this day is on the timetable. Open the full lineup to see them.'
            : 'No announced acts for this day yet.'}
        </p>
      ) : view === 'poster' ? (
        <div className="mt-3 flex flex-col gap-3">
          {groupLineupByTier(selection.active).map((group) => (
            <Rows key={group.tier ?? 'none'} entries={group.entries} textClass={tierText(group.tier)} ctx={ctx} />
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {groupLineupAlphabetically(selection.active, festival?.b2bSeparator).map((group) => (
            <div key={group.letter}>
              <h3 className="text-sm font-semibold text-text-secondary">{group.letter}</h3>
              <Rows entries={group.entries} textClass="text-base font-medium" ctx={ctx} />
            </div>
          ))}
        </div>
      )}

      {selection.cancelled.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-text-secondary">Cancelled</h3>
          <Rows entries={selection.cancelled} textClass="text-base" ctx={ctx} />
        </div>
      )}
    </section>
  );
}
