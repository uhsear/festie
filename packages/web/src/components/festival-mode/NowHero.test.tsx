import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fmtZonedClock, type NowNextSelection } from '@festie/shared/utils';
import NowHero from './NowHero';

const NOW = Date.parse('2026-06-12T17:30:00Z');

const selection = {
  phase: 'during',
  current: [],
  upcoming: [
    {
      set: { id: 's2', artist: 'Fred', stageId: 'main', startTime: '19:00', endTime: '20:00' },
      start: NOW + 90 * 60_000,
      end: NOW + 150 * 60_000,
    },
  ],
  todayCount: 1,
  startsAt: null,
} as unknown as NowNextSelection;

function renderHero(walk?: { minutes: number; late: boolean; label: string } | null) {
  return render(
    <NowHero
      selection={selection}
      nowMs={NOW}
      timeZone="UTC"
      lineupMode
      getStageName={() => 'Main'}
      onOpenSet={vi.fn()}
      onBrowse={vi.fn()}
      walk={walk}
    />,
  );
}

describe('NowHero walk time', () => {
  it('adds the walk label to the stage line and the accessible name', () => {
    renderHero({ minutes: 6, late: false, label: '6 min walk' });
    const hero = screen.getByTestId('fm-next-hero');
    expect(hero).toHaveTextContent('Head to Main · 6 min walk');
    expect(screen.getByRole('button', { name: /, 6 minute walk\. Open details$/ })).toBeInTheDocument();
  });

  it('turns the countdown amber when the walk is late', () => {
    renderHero({ minutes: 120, late: true, label: '120 min walk' });
    expect(screen.getByText('in 1h 30m')).toHaveClass('text-accent-amber');
    expect(screen.getByRole('button', { name: /, leave now\. Open details$/ })).toBeInTheDocument();
  });

  it('keeps the plain stage line without a walk', () => {
    renderHero();
    expect(screen.getByText('Head to Main')).toBeInTheDocument();
    expect(screen.getByText('in 1h 30m')).not.toHaveClass('text-accent-amber');
  });
});

describe('NowHero next card clock', () => {
  const hero = (startMs: number) =>
    render(
      <NowHero
        selection={
          {
            phase: 'during',
            current: [],
            upcoming: [{ set: { id: 's3', artist: 'Gus', stageId: 'main', startTime: '14:00', endTime: '15:00' }, start: startMs, end: startMs + 3_600_000 }],
            todayCount: 1,
            startsAt: null,
          } as unknown as NowNextSelection
        }
        nowMs={NOW}
        timeZone="UTC"
        lineupMode
        getStageName={() => 'Main'}
        onOpenSet={vi.fn()}
        onBrowse={vi.fn()}
      />,
    );
  const count = (text: string, part: string) => text.split(part).length - 1;

  it('shows the clock beside a relative countdown', () => {
    const start = NOW + 90 * 60_000;
    hero(start);
    expect(count(screen.getByTestId('fm-next-hero').textContent ?? '', fmtZonedClock(start, 'UTC'))).toBe(1);
  });

  it('shows one time label when the countdown is already a weekday and clock', () => {
    const start = NOW + 26 * 3_600_000;
    hero(start);
    expect(count(screen.getByTestId('fm-next-hero').textContent ?? '', fmtZonedClock(start, 'UTC'))).toBe(1);
  });
});

describe('NowHero before the festival', () => {
  const before = (startsAtTimed: boolean) =>
    render(
      <NowHero
        selection={{ phase: 'before', current: [], upcoming: [], todayCount: 0, startsAt: NOW + 3 * 3_600_000, startsAtTimed } as unknown as NowNextSelection}
        nowMs={NOW}
        timeZone="UTC"
        lineupMode
        getStageName={() => 'Main'}
        onOpenSet={vi.fn()}
        onBrowse={vi.fn()}
      />,
    );

  it('names only the weekday and skips "First set" when no set has a time yet', () => {
    before(false);
    expect(screen.getByText(/^Starts Fri/)).not.toHaveTextContent(/\d:\d\d/);
    expect(screen.queryByText(/First set/)).not.toBeInTheDocument();
  });

  it('shows the start clock and the countdown once set times exist', () => {
    before(true);
    expect(screen.getByText(/^Starts Fri.*\d/)).toBeInTheDocument();
    expect(screen.getByText(/^First set/)).toBeInTheDocument();
  });
});

describe('NowHero live handoff', () => {
  const live = (id: string, artist: string) =>
    ({
      phase: 'during',
      current: [{ set: { id, artist, stageId: 'main', startTime: '17:00', endTime: '18:00' }, start: NOW - 30 * 60_000, end: NOW + 30 * 60_000 }],
      upcoming: [],
      todayCount: 1,
      startsAt: null,
    }) as unknown as NowNextSelection;
  const props = { nowMs: NOW, timeZone: 'UTC', lineupMode: true, getStageName: () => 'Main', onOpenSet: vi.fn(), onBrowse: vi.fn() };

  it('enters with fm-card-enter and drops the animation under reduced motion', () => {
    render(<NowHero {...props} selection={live('s1', 'Ann')} />);
    expect(screen.getByTestId('fm-now-card')).toHaveClass('fm-card-enter', 'motion-reduce:animate-none');
  });

  it('remounts the card when the live set changes, so the entrance replays', () => {
    const { rerender } = render(<NowHero {...props} selection={live('s1', 'Ann')} />);
    const first = screen.getByTestId('fm-now-card');
    rerender(<NowHero {...props} selection={live('s2', 'Bob')} />);
    expect(screen.getByTestId('fm-now-card')).not.toBe(first);
  });

  it('enters the next card too', () => {
    renderHero();
    expect(screen.getByTestId('fm-next-hero')).toHaveClass('fm-card-enter');
  });
});

describe('NowHero lead object', () => {
  const props = {
    nowMs: NOW,
    timeZone: 'UTC',
    lineupMode: true,
    getStageName: () => 'Main',
    onOpenSet: vi.fn(),
    onBrowse: vi.fn(),
  };

  const liveSel = (end: number, priority: 'must' | null = null) =>
    ({
      phase: 'during',
      current: [{ set: { id: 's1', artist: 'Ann', stageId: 'main', startTime: '17:00', endTime: '18:00' }, start: NOW - 30 * 60_000, end, priority }],
      upcoming: [],
      todayCount: 1,
      startsAt: null,
    }) as unknown as NowNextSelection;

  it('sets the live name in ink and carries the stage colour on a rail, so contrast does not depend on the stage hue', () => {
    render(<NowHero {...props} selection={liveSel(NOW + 30 * 60_000)} getStageColor={() => 'rgb(1, 2, 3)'} />);
    expect(screen.getByText('Ann').closest('[style]')).toBeNull();
    expect(screen.getByText('Ann').parentElement).toHaveClass('text-text-primary');
    expect(screen.getByTestId('fm-stage-rail')).toHaveStyle({ background: 'rgb(1, 2, 3)' });
  });

  it('keeps one fixed row per live card: stage and end time left, countdown right', () => {
    render(<NowHero {...props} selection={liveSel(NOW + 30 * 60_000, 'must')} />);
    const card = screen.getByTestId('fm-now-card');
    expect(card).toHaveTextContent(`Main · until ${fmtZonedClock(NOW + 30 * 60_000, 'UTC')}`);
    expect(card).toHaveTextContent('Must');
    const countdown = screen.getByTestId('fm-lead-countdown');
    expect(countdown).toHaveClass('type-heading', 'tabular-nums', 'shrink-0');
    expect(countdown.parentElement).toContainElement(screen.getByText(/until/));
  });

  it('keeps "until <time>" on one line so the meta group wraps as a unit, not mid-phrase', () => {
    render(<NowHero {...props} selection={liveSel(NOW + 30 * 60_000)} />);
    const until = screen.getByTestId('fm-until');
    expect(until).toHaveClass('whitespace-nowrap');
    expect(until).toHaveTextContent(`until ${fmtZonedClock(NOW + 30 * 60_000, 'UTC')}`);
    // The nowrap phrase sits inside the shrinkable meta group, not in the fixed countdown column.
    expect(until.parentElement).toHaveClass('min-w-0');
    expect(until.parentElement).not.toHaveClass('whitespace-nowrap');
  });

  it('turns the countdown to the danger red, not amber, in the last ten minutes of a set', () => {
    const { unmount } = render(<NowHero {...props} selection={liveSel(NOW + 9 * 60_000)} />);
    expect(screen.getByTestId('fm-lead-countdown')).toHaveClass('text-text-danger');
    expect(screen.getByTestId('fm-lead-countdown')).not.toHaveClass('text-accent-amber');
    unmount();
    render(<NowHero {...props} selection={liveSel(NOW + 11 * 60_000)} />);
    expect(screen.getByTestId('fm-lead-countdown')).not.toHaveClass('text-text-danger');
  });

  it('leads with a display-lg countdown before the festival', () => {
    const sel = { phase: 'before', current: [], upcoming: [], todayCount: 0, startsAt: NOW + 3 * 3_600_000, startsAtTimed: true } as unknown as NowNextSelection;
    render(<NowHero {...props} selection={sel} />);
    expect(screen.getByTestId('fm-lead-countdown')).toHaveClass('type-display-lg', 'tabular-nums');
  });

  it('counts days when the festival is more than half a day away', () => {
    const sel = { phase: 'before', current: [], upcoming: [], todayCount: 0, startsAt: NOW + 3 * 86_400_000, startsAtTimed: true } as unknown as NowNextSelection;
    render(<NowHero {...props} selection={sel} />);
    expect(screen.getByTestId('fm-lead-countdown')).toHaveTextContent('3 days');
  });

  it('shows a Wrap thumbnail after the festival and never prints the festival name', () => {
    const sel = { phase: 'after', current: [], upcoming: [], todayCount: 0, startsAt: null } as unknown as NowNextSelection;
    render(<NowHero {...props} selection={sel} festivalName="Bonnaroo 2026" />);
    expect(screen.getByTestId('fm-wrap-thumb')).toBeInTheDocument();
    expect(screen.queryByText(/Bonnaroo/)).not.toBeInTheDocument();
  });
});
