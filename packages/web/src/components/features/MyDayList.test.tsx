import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MyDay } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import MyDayList from './MyDayList';

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ currentFestival: { b2bSeparator: undefined } }),
  ),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: vi.fn(() => ({
    getStageName: (id: string) => (id === 'st1' ? 'Main Stage' : 'Sahara'),
    getStageColor: () => '#00e8d0',
  })),
}));

vi.mock('@festie/shared/utils', () => ({
  artistDisplayName: (set: { artist?: string }) => set.artist ?? 'Unknown',
  formatTime: (t: string) => t,
  fmtDurationMinutes: (m: number) => `${m} min`,
  fmtZonedClock: () => '7:00 PM',
  resolveStageColor: (c: string | null | undefined, fallback: string) => c || fallback,
}));

vi.mock('../ui/StageBadge', () => ({
  default: ({ stageName }: { stageName: string }) => <span data-testid="stage-badge">{stageName}</span>,
}));

vi.mock('../ui/PriorityIcon', () => ({ default: () => <span data-testid="priority-icon" /> }));

const setA = { id: 'a', artist: 'Fisher', stageId: 'st1', startTime: '21:00', endTime: '22:30' } as FestivalSet;
const setB = { id: 'b', artist: 'Chris Lake', stageId: 'st2', startTime: '22:00', endTime: '23:30' } as FestivalSet;
const setC = { id: 'c', artist: 'Four Tet', stageId: 'st1' } as FestivalSet;

const myDay: MyDay = {
  sections: [
    {
      part: 'evening',
      title: 'Evening',
      items: [
        { kind: 'meet', key: 'm1', meetingPointId: 'm1', label: 'Crew', location: 'Gate', startMs: 0 },
        { kind: 'gap', key: 'g1', minutes: 45, startMs: 0 },
      ],
    },
    {
      part: 'late-night',
      title: 'Late night',
      items: [
        {
          kind: 'set',
          key: 'a',
          set: setA,
          priority: 'must',
          startMs: 0,
          endMs: 1,
          walkFromPrev: null,
          clashLabel: 'Clashes with Chris Lake (30 min)',
        },
        {
          kind: 'set',
          key: 'b',
          set: setB,
          priority: 'maybe',
          startMs: 2,
          endMs: 3,
          walkFromPrev: { minutes: 6, fromStageId: 'st1' },
          clashLabel: null,
        },
      ],
    },
  ],
  unscheduled: [setC],
  pickCount: 3,
};

describe('MyDayList', () => {
  it('renders section titles, gap, walk, meet and clash chip', () => {
    render(<MyDayList myDay={myDay} onOpenSet={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Evening' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Late night' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Time not announced' })).toBeInTheDocument();
    expect(screen.getByText('45 min free')).toBeInTheDocument();
    expect(screen.getByText('6 min walk from Main Stage')).toBeInTheDocument();
    expect(screen.getByText('Meet: Crew')).toBeInTheDocument();
    expect(screen.getByText('7:00 PM')).toBeInTheDocument();
    expect(screen.getByText('Clashes with Chris Lake (30 min)')).toBeInTheDocument();
  });

  it('calls onOpenSet with the set when a row is clicked', () => {
    const onOpenSet = vi.fn();
    render(<MyDayList myDay={myDay} onOpenSet={onOpenSet} />);
    fireEvent.click(screen.getByRole('button', { name: /Fisher/ }));
    expect(onOpenSet).toHaveBeenCalledWith(setA);
  });
});
