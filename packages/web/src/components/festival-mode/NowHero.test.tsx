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

  it('turns the countdown coral when the walk is late', () => {
    renderHero({ minutes: 120, late: true, label: '120 min walk' });
    expect(screen.getByText('in 1h 30m')).toHaveClass('text-accent-coral');
    expect(screen.getByRole('button', { name: /, leave now\. Open details$/ })).toBeInTheDocument();
  });

  it('keeps the plain stage line without a walk', () => {
    renderHero();
    expect(screen.getByText('Head to Main')).toBeInTheDocument();
    expect(screen.getByText('in 1h 30m')).not.toHaveClass('text-accent-coral');
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
