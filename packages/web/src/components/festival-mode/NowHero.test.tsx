import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NowNextSelection } from '@festie/shared/utils';
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
    expect(hero.getAttribute('aria-label')).toContain(', 6 minute walk. Open details');
  });

  it('turns the countdown coral when the walk is late', () => {
    renderHero({ minutes: 120, late: true, label: '120 min walk' });
    expect(screen.getByText('in 1h 30m')).toHaveClass('text-accent-coral');
    expect(screen.getByTestId('fm-next-hero').getAttribute('aria-label')).toContain(', leave now');
  });

  it('keeps the plain stage line without a walk', () => {
    renderHero();
    expect(screen.getByText('Head to Main')).toBeInTheDocument();
    expect(screen.getByText('in 1h 30m')).not.toHaveClass('text-accent-coral');
  });
});
