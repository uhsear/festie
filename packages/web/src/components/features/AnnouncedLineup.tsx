import React, { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useInterestedRows } from '@festie/shared/hooks/useInterest';
import type { Festival, FestivalSet, LineupEntry, Stage } from '@festie/shared/types';
import {
  LINEUP_VIEW_KEY,
  groupLineupAlphabetically,
  groupLineupByTier,
  lineupCoveringSets,
  lineupEntryBadge,
  lineupEntryName,
  lineupSetWhen,
  parseLineupView,
  searchLineupEntries,
  selectLineupEntries,
} from '@festie/shared/utils';
import type { AnnouncedLineupModel, InterestRow, LineupView } from '@festie/shared/utils';
import { lineupEntrySegments } from '@festie/shared/utils/artistSheet';
import { useNow } from '../../hooks/useSetStatus';
import { ArtistNameButton } from './ArtistName';
import { InterestToggle, sheetButtonClass as buttonClass } from './ArtistSheetHost';
import { cn } from '../../lib/utils';


const COPY_SEEN_KEY = 'festie.interestCopySeen';
const INTEREST_COPY = 'Marked acts become want-to-see picks when sets are out. Your crew sees your picks.';
const VIEWS: { key: LineupView; label: string }[] = [
  { key: 'poster', label: 'Poster' },
  { key: 'az', label: 'A-Z' },
];

function readView(): LineupView {
  try {
    return parseLineupView(window.localStorage.getItem(LINEUP_VIEW_KEY));
  } catch {
    // Storage can be blocked (private mode); the view then lasts for this visit only.
    return 'poster';
  }
}

function writeView(view: LineupView) {
  try {
    window.localStorage.setItem(LINEUP_VIEW_KEY, view);
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
const chipClass = (active: boolean) =>
  buttonClass + (active ? 'bg-accent-aqua text-[var(--text-on-light-accent)]' : 'bg-transparent text-text-secondary hover:text-text-primary');

function readCopySeen(): boolean {
  try {
    return window.localStorage.getItem(COPY_SEEN_KEY) === '1';
  } catch {
    // Storage can be blocked (private mode); the line then shows again next visit.
    return false;
  }
}

function writeCopySeen() {
  try {
    window.localStorage.setItem(COPY_SEEN_KEY, '1');
  } catch {
    // Same as readCopySeen: a blocked store only loses the "seen" flag.
  }
}

/** What a row needs to describe an act, read once by the component instead of once per row. */
interface RowContext {
  cover: AnnouncedLineupModel['cover'];
  days: AnnouncedLineupModel['days'];
  sets: FestivalSet[];
  stages: Stage[];
  festival: Festival | null;
  nowMs: number;
  /** Called when the user marks an act, so the "marked acts become picks" line can retire. */
  onMarked: () => void;
}

/** One act: the poster name, its badges and, for a scheduled act, where it plays. */
function LineupRow({ entry, textClass, ctx }: { entry: LineupEntry; textClass: string; ctx: RowContext }) {
  const entryCover = ctx.cover[entry.id];
  if (!entryCover) return null;

  const name = lineupEntryName(entry, ctx.festival?.b2bSeparator);
  const badges = lineupEntryBadge(entry, entryCover, ctx.days, ctx.festival?.publishedAt, ctx.nowMs);
  const first = entryCover.state === 'scheduled' ? lineupCoveringSets(entryCover, ctx.sets)[0] : undefined;
  const nameClass = cn(textClass, entryCover.state === 'cancelled' && 'line-through text-text-muted');
  const segments = lineupEntrySegments(entry, ctx.festival?.b2bSeparator, entryCover.state === 'announced');

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
      <span className="inline-flex flex-wrap items-baseline gap-x-1 min-h-11 text-text-primary">
        {segments.map((seg, i) => (
          <React.Fragment key={`${seg.label}-${i}`}>
            {i > 0 && <span className={nameClass}>{ctx.festival?.b2bSeparator || 'b2b'}</span>}
            <ArtistNameButton target={seg.target} className={nameClass}>
              {seg.label}
            </ArtistNameButton>
          </React.Fragment>
        ))}
      </span>
      {first && (
        <Link
          to="/set/$setId"
          params={{ setId: first.id }}
          aria-label={`${name}, ${lineupSetWhen(first, ctx.days, ctx.stages)}`}
          className="min-h-11 inline-flex items-center text-sm text-text-secondary"
        >
          {lineupSetWhen(first, ctx.days, ctx.stages)}
        </Link>
      )}
      {badges.map((badge) => (
        <span key={badge.kind} className={cn(pillClass, badge.kind === 'new' && 'border-accent-aqua text-accent-aqua')}>
          {badge.text}
        </span>
      ))}
      {entryCover.state === 'announced' && <InterestToggle entryId={entry.id} name={name} onMarked={ctx.onMarked} />}
    </li>
  );
}

/** One mark in the Interested view. A converted mark reads the user's real picks, not the mark. */
function InterestedRowView({ row, ctx }: { row: InterestRow; ctx: RowContext }) {
  const bulkSavePicks = useFestivalStore((s) => s.bulkSavePicks);
  const name = lineupEntryName(row.entry, ctx.festival?.b2bSeparator);
  const badges = lineupEntryBadge(row.entry, row.cover, ctx.days, ctx.festival?.publishedAt, ctx.nowMs);
  const status: Record<InterestRow['status'], string | null> = {
    waiting: null,
    'has-set': 'Has a set now',
    'in-picks': `In your picks · ${row.pickedWhen}`,
    'not-in-picks': 'Not in your picks',
    cancelled: null,
  };
  const addToPicks = () => {
    // bulkSavePicks rolls its optimistic picks back and sets the store error when the write fails.
    void bulkSavePicks(row.addSetIds, 'want-to-see').catch(() => {});
  };
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
      <ArtistNameButton
        target={{ title: name, artists: row.entry.artists, entryId: row.status === 'cancelled' ? undefined : row.entry.id }}
        className={cn('text-base font-medium', row.status === 'cancelled' && 'line-through text-text-muted')}
      >
        {name}
      </ArtistNameButton>
      {badges.map((badge) => (
        <span key={badge.kind} className={pillClass}>
          {badge.text}
        </span>
      ))}
      {status[row.status] && <span className="text-sm text-text-secondary">{status[row.status]}</span>}
      {row.addSetIds.length > 0 && (
        <button type="button" onClick={addToPicks} className={cn(buttonClass, 'border border-border text-text-primary')}>
          Add to picks
        </button>
      )}
      {row.status !== 'cancelled' && <InterestToggle entryId={row.entry.id} name={name} />}
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
  const [copySeen, setCopySeen] = useState(readCopySeen);
  const interestedRows = useInterestedRows();
  const onMarked = () => {
    writeCopySeen();
    setCopySeen(true);
  };

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
  const ctx: RowContext = {
    cover: model.cover,
    days: model.days,
    sets: sets ?? [],
    stages: stages ?? [],
    festival,
    nowMs,
    onMarked,
  };

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
        'w-full mx-auto max-w-[1440px] mb-[var(--space-4)] rounded-lg border border-border bg-bg-card px-4 py-3',
        className,
      )}
    >
      <h2 id="announced-lineup-heading" className="text-sm font-semibold text-text-primary">
        Announced lineup
      </h2>
      <p className="text-sm text-text-secondary">
        {summary.header}
        {interestedRows.length > 0 && ` · ${interestedRows.length} marked`}
      </p>
      {model.noSets && <p className="text-sm text-text-secondary">Set times aren&apos;t out yet. Mark the acts you want to see.</p>}
      {!copySeen && <p className="text-sm text-text-secondary">{INTEREST_COPY}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 rounded-full bg-bg-secondary" role="group" aria-label="Lineup view">
          {[...VIEWS, { key: 'interested' as const, label: `Interested (${interestedRows.length})` }].map(({ key, label }) => (
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

      {view === 'interested' ? (
        <div className="mt-3">
          <p className="text-sm text-text-secondary mb-1">{INTEREST_COPY}</p>
          {interestedRows.length === 0 ? (
            <p className="text-sm text-text-secondary">You have not marked any acts yet.</p>
          ) : (
            <ul className="flex flex-col">
              {interestedRows.map((row) => (
                <InterestedRowView key={row.entry.id} row={row} ctx={ctx} />
              ))}
            </ul>
          )}
        </div>
      ) : nothingToList ? (
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

      {view !== 'interested' && selection.cancelled.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-text-secondary">Cancelled</h3>
          <Rows entries={selection.cancelled} textClass="text-base" ctx={ctx} />
        </div>
      )}
    </section>
  );
}
