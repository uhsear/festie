import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFestivalSet } from '@festie/shared/test-fixtures/festivalSet';
import type { FestivalSet } from '@festie/shared/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const festivalState: Record<string, unknown> = {};
const nowMs = Date.UTC(2026, 10, 7, 21, 0);

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(festivalState),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: null }),
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ crews: [] }),
  selectMyPicks: () => null,
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ setDetailSet: vi.fn(), setDetailAutoSpotify: vi.fn() }),
}));
vi.mock('@festie/shared/hooks', () => ({
  useFestivalReady: () => ({ visible: false, items: [], doneCount: 0, total: 4, progressLabel: '', hide: vi.fn() }),
  useCanPick: () => true,
  usePicks: () => ({ getMyPick: () => null, getOtherPicks: () => [] }),
  useFestival: () => ({
    getStageColor: () => '#ccc',
    getStageName: () => 'Main',
    getDays: () => (festivalState.days as unknown[]) ?? [],
    // The day's sets pass through, unless a test turns on `hideAll` to stand in for My picks, a stage or genre filter.
    getFilteredSets: () =>
      festivalState.hideAll
        ? []
        : (festivalState.sets as { dayIndex: number }[]).filter((s) => s.dayIndex === festivalState.selectedDay),
  }),
}));
vi.mock('../hooks/useSetStatus', () => ({ useNow: () => nowMs }));
// The announced lineup reads the viewer's marks from the real store, which this file's store mocks replace.
vi.mock('@festie/shared/hooks/useInterest', () => ({
  useInterest: () => ({ mark: undefined, marked: false, toggle: () => Promise.resolve() }),
  useInterestedRows: () => [],
}));
vi.mock('../components/ui/Avatar', () => ({ default: () => null }));
vi.mock('../components/features/SetCard', () => ({
  default: ({ set }: { set: { id: string } }) => <div data-testid="set-card" data-id={set.id} />,
}));
vi.mock('../components/features/PhaseHomeActions', () => ({ default: () => <div data-testid="band" /> }));
vi.mock('../components/features/OtherDayMatches', () => ({ default: () => null }));
vi.mock('../hooks/useOfflineDownload', () => ({ useOfflineDownload: () => ({ mapStatus: null }) }));
vi.mock('../components/features/OfflineStatusChip', () => ({ default: () => null }));
vi.mock('../components/features/ScheduleEmptyState', () => ({ default: () => <div data-testid="empty-state" /> }));
vi.mock('../components/features/SetTimesBanner', () => ({ default: () => null }));
vi.mock('../components/features/DiscoverRow', () => ({ default: () => null }));
vi.mock('../components/ui/skeletons/CardsSkeleton', () => ({ default: () => <div data-testid="cards-skeleton" /> }));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardsView from './cards';

const mkSet = (id: string, start: string, end: string): FestivalSet =>
  makeFestivalSet({ id, dayIndex: 0, startTime: start, endTime: end, stageId: 's1', artist: id });

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
      festivals: [],
      error: null,
      loadFestivals: vi.fn(),
      selectFestival: vi.fn(),
      setSelectedDay: vi.fn(),
      setActiveStages: vi.fn(),
      setOnlyMine: vi.fn(),
    });
  });

  const ids = () => screen.getAllByTestId('set-card').map((e) => e.getAttribute('data-id'));

  it('shows the load error and a retry, not the skeleton, when the festival list failed', () => {
    Object.assign(festivalState, { currentFestival: null, error: 'Network down' });
    render(<CardsView />);
    expect(screen.getByText("Couldn't load festivals")).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByTestId('cards-skeleton')).not.toBeInTheDocument();
  });

  it('folds ended sets into one collapsed row and keeps time order', () => {
    render(<CardsView />);
    expect(screen.getByRole('button', { name: 'Earlier today (2), show sets that ended earlier' })).toHaveTextContent(
      'Earlier today (2)',
    );
    expect(ids()).toEqual(['now', 'late']);
  });

  it('expands and collapses the earlier sets', async () => {
    render(<CardsView />);
    await userEvent.click(screen.getByRole('button', { name: /Earlier today \(2\), show/ }));
    const toggle = screen.getByRole('button', { name: 'Hide earlier sets' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide earlier sets');
    expect(ids()).toEqual(['early', 'mid', 'now', 'late']);
    await userEvent.click(toggle);
    expect(ids()).toEqual(['now', 'late']);
  });

  it('shows ended sets, with no fold row, when nothing is left today', () => {
    festivalState.sets = [mkSet('early', '14:00', '15:00'), mkSet('mid', '18:00', '19:00')];
    render(<CardsView />);
    expect(screen.queryByText(/Earlier today/)).not.toBeInTheDocument();
    expect(ids()).toEqual(['early', 'mid']);
  });

  it('does not fold a search behind the earlier row', () => {
    festivalState.searchQuery = 'early';
    render(<CardsView />);
    expect(screen.queryByText(/Earlier today/)).not.toBeInTheDocument();
    expect(ids()).toEqual(['early', 'mid', 'now', 'late']);
  });

  it('shows no earlier row before the festival starts', () => {
    festivalState.days = [{ index: 0, date: '2026-11-20', label: 'Day 1' }];
    render(<CardsView />);
    expect(screen.queryByText(/Earlier today/)).not.toBeInTheDocument();
    expect(ids()).toEqual(['early', 'mid', 'now', 'late']);
  });
});

describe('CardsView announced lineup', () => {
  const entry = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    artists: [{ name }],
    displayName: null,
    tier: null,
    dayDate: null,
    status: 'announced',
    announcedAt: '2026-10-01',
    linkedSetIds: [],
    ...extra,
  });
  const setLineup = (lineup: unknown[]) => {
    (festivalState.currentFestival as { lineup: unknown[] }).lineup = lineup;
  };

  beforeEach(() => {
    Object.assign(festivalState, {
      currentProfile: null,
      currentFestival: {
        id: 'f1',
        timeZone: 'UTC',
        startDate: '2026-11-20',
        endDate: '2026-11-21',
        lineup: [entry('1', 'Announced Act'), entry('2', 'Second Act')],
      },
      days: [
        { index: 0, date: '2026-11-20', label: 'Fri' },
        { index: 1, date: '2026-11-21', label: 'Sat' },
      ],
      sets: [],
      selectedDay: 0,
      stages: [],
      searchQuery: '',
      hideAll: false,
      isLoading: false,
      error: null,
    });
  });

  it('shows the lineup instead of "No sets for this day" when the festival has no sets', () => {
    render(<CardsView />);
    expect(screen.getByText('2 acts announced · Set times TBA')).toBeInTheDocument();
    expect(screen.getByText('Announced Act')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('shows a day with no sets the acts for that day, and keeps the empty state when it has none', () => {
    festivalState.sets = [{ ...mkSet('s1', '20:00', '21:00'), artist: 'Announced Act' }];
    festivalState.selectedDay = 1;
    setLineup([entry('1', 'Announced Act'), entry('2', 'Saturday Act', { dayDate: '2026-11-21' })]);
    const { unmount } = render(<CardsView />);
    expect(screen.getByText('Saturday Act')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    unmount();

    // Every act is on the timetable and day 2 has no sets: nothing to list, so the plain empty state stays.
    setLineup([entry('1', 'Announced Act')]);
    render(<CardsView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('keeps the empty state when a filter emptied a day that has sets', () => {
    festivalState.sets = [mkSet('s1', '20:00', '21:00')];
    festivalState.hideAll = true;
    render(<CardsView />);
    festivalState.hideAll = false;
    // The lineup block stays above, as on any day; it must not take the filter's empty state with it.
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('lists the announced acts that match a search under the set results', () => {
    festivalState.sets = [mkSet('s1', '20:00', '21:00')];
    festivalState.searchQuery = 'second';
    const { container } = render(<CardsView />);
    expect(screen.getByRole('heading', { name: 'Announced acts' })).toBeInTheDocument();
    expect(screen.getByText('Second Act')).toBeInTheDocument();
    expect(screen.queryByText('Announced Act')).not.toBeInTheDocument();
    const grid = container.querySelector('[aria-label="Card view"]');
    const heading = screen.getByRole('heading', { name: 'Announced acts' });
    expect(grid && grid.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the empty state for a festival with no announced acts', () => {
    setLineup([]);
    render(<CardsView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByText(/acts announced/)).not.toBeInTheDocument();
  });
});
