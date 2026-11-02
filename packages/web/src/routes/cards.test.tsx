import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const festivalState: Record<string, unknown> = {};
const nowMs = Date.UTC(2026, 10, 7, 21, 0);

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(festivalState),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: null }),
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ crews: [] }),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ setDetailSet: vi.fn(), setDetailAutoSpotify: vi.fn() }),
}));
vi.mock('@festie/shared/hooks', () => ({
  usePicks: () => ({ getMyPick: () => null, getOtherPicks: () => [] }),
  useFestival: () => ({
    getStageColor: () => '#ccc',
    getStageName: () => 'Main',
    getDays: () => (festivalState.days as unknown[]) ?? [],
  }),
}));
vi.mock('../hooks/useSetStatus', () => ({ useNow: () => nowMs }));
vi.mock('../hooks/useScheduleFilters', () => ({
  useScheduleFilters: () => ({ filterSets: (s: unknown[]) => [...s] }),
}));
vi.mock('../components/features/SetCard', () => ({
  default: ({ set }: { set: { id: string } }) => <div data-testid="set-card" data-id={set.id} />,
}));
vi.mock('../components/features/PhaseHomeActions', () => ({ default: () => <div data-testid="band" /> }));
vi.mock('../components/features/OtherDayMatches', () => ({ default: () => null }));
vi.mock('../components/ui/EmptyState', () => ({ default: () => <div data-testid="empty-state" /> }));
vi.mock('../components/ui/skeletons/CardsSkeleton', () => ({ default: () => <div /> }));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardsView from './cards';

const mkSet = (id: string, start: string, end: string) => ({
  id,
  dayIndex: 0,
  startTime: start,
  endTime: end,
  stageId: 's1',
  artist: id,
});

describe('CardsView order and earlier row', () => {
  beforeEach(() => {
    Object.assign(festivalState, {
      currentProfile: null,
      currentFestival: { id: 'f1', timeZone: 'UTC', startDate: '2026-11-07', endDate: '2026-11-08' },
      days: [{ index: 0, date: '2026-11-07', label: 'Day 1' }],
      sets: [
        mkSet('late', '22:00', '23:00'),
        mkSet('early', '14:00', '15:00'),
        mkSet('mid', '18:00', '19:00'),
        mkSet('now', '20:30', '21:30'),
      ],
      selectedDay: 0,
      stages: [],
      searchQuery: '',
      isLoading: false,
      setSelectedDay: vi.fn(),
      setActiveStages: vi.fn(),
      setOnlyMine: vi.fn(),
    });
  });

  const ids = () => screen.getAllByTestId('set-card').map((e) => e.getAttribute('data-id'));

  it('folds ended sets into one collapsed row and keeps time order', () => {
    render(<CardsView />);
    expect(screen.getByRole('button', { name: 'Show 2 sets that ended earlier today' })).toHaveTextContent(
      'Earlier today (2)',
    );
    expect(ids()).toEqual(['now', 'late']);
  });

  it('expands and collapses the earlier sets', async () => {
    render(<CardsView />);
    await userEvent.click(screen.getByRole('button', { name: /ended earlier today/ }));
    const toggle = screen.getByRole('button', { name: 'Hide sets that ended earlier today' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide earlier sets');
    expect(ids()).toEqual(['early', 'mid', 'now', 'late']);
    await userEvent.click(toggle);
    expect(ids()).toEqual(['now', 'late']);
  });

  it('shows no earlier row before the festival starts', () => {
    festivalState.days = [{ index: 0, date: '2026-11-20', label: 'Day 1' }];
    render(<CardsView />);
    expect(screen.queryByText(/Earlier today/)).not.toBeInTheDocument();
    expect(ids()).toEqual(['early', 'mid', 'now', 'late']);
  });
});
