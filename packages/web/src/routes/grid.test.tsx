import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ConflictGroup } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';

// Mock dependencies
const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('../lib/useUndoNotifier', () => ({
  useUndoNotifier: () => ({ info: vi.fn(), error: vi.fn(), undo: vi.fn() }),
}));
vi.mock('../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: Object.assign(vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)), { subscribe: vi.fn() }),
}));

vi.mock('@festie/shared/stores/festivalModeStore', () => ({
  useFestivalModeStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ lowPowerMode: false })),
}));

vi.mock('../components/features/LastSyncedBadge', () => ({
  default: () => <div data-testid="last-synced-badge" />,
}));

vi.mock('../components/features/LowPowerIndicator', () => ({
  default: () => null,
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));

const noClashes = { count: 0, marks: new Map(), groups: [] as ConflictGroup[], picked: 0 };

// getFilteredSets runs the real shared filter against the store fixture.
vi.mock('@festie/shared/hooks', async () => {
  const { filterScheduleSets } = await import('@festie/shared/utils');
  return {
    usePickClear: () => vi.fn(),
    usePicks: vi.fn(() => ({
      getMyPick: vi.fn(() => null),
      getOtherPicks: vi.fn(() => []),
      savePick: vi.fn(),
    })),
    useFestival: vi.fn(() => ({
      getStageColor: vi.fn(() => '#ccc'),
      getStageName: vi.fn(() => 'Main Stage'),
      getFilteredSets: () => {
        const st = storeState as {
          sets: { dayIndex: number }[];
          stages: never[];
          selectedDay: number;
          activeStages: string[];
          onlyMine?: boolean;
          searchQuery?: string;
          currentProfile?: { picks?: Record<string, string> };
        };
        return filterScheduleSets(st.sets.filter((x) => x.dayIndex === st.selectedDay) as never[], {
          activeStages: st.activeStages,
          stages: st.stages,
          onlyMine: !!st.onlyMine,
          picks: st.currentProfile?.picks,
          query: st.searchQuery ?? '',
        });
      },
    })),
    useDayClashes: vi.fn(() => noClashes),
    useViewAs: () => ({ target: null, canView: () => false, start: vi.fn(), clear: vi.fn() }),
  };
});

vi.mock('../components/ui/EmptyState', () => ({
  default: ({
    title,
    description,
    cta,
  }: {
    title: string;
    description?: string;
    cta?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));

vi.mock('../components/layout/RefreshableView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="refreshable-view">{children}</div>,
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Lightweight stand-in: exposes the props the route owns (rowHeight, gridRef)
// and one [data-set-id] cell per set so the clash chip can find its target.
vi.mock('../features/TimelineGrid', () => ({
  default: ({
    gridRef,
    timedSets,
    rowHeight,
  }: {
    gridRef: React.RefObject<HTMLDivElement | null>;
    timedSets: FestivalSet[];
    rowHeight: number;
  }) => (
    <div ref={gridRef} data-testid="timeline-grid" style={{ gridTemplateRows: `auto repeat(4, ${rowHeight}px)` }}>
      {timedSets.map((s) => (
        <div key={s.id} data-set-id={s.id}>
          <button type="button" data-open>
            {s.artist}
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/timeline/TimelineLegend', () => ({
  default: () => <div data-testid="timeline-legend" />,
}));

vi.mock('../components/grid/useGridExport', () => ({
  useGridExport: vi.fn(() => ({ exporting: false, exportGrid: vi.fn() })),
}));

// Mock the custom hooks used by GridViewInner
const mockTimelineFilters = {
  currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined },
  stages: [{ id: 'st1', name: 'Main Stage' }],
  selectedDay: 0,
  visibleStages: [{ id: 'st1', name: 'Main Stage' }],
  allDaySets: [],
  timedSets: [],
  timelessSets: [],
  conflictIds: new Set<string>(),
  timeBounds: null,
};

vi.mock('../hooks/useTimelineFilters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useTimelineFilters')>()),
  useTimelineFilters: vi.fn(() => mockTimelineFilters),
}));

vi.mock('../hooks/useTimelineViewport', () => ({
  useTimelineViewport: vi.fn(() => ({ vpW: 1024, vpH: 900 })),
}));

const gridRef = { current: null as HTMLDivElement | null };

vi.mock('../hooks/useNowIndicator', () => ({
  useNowIndicator: vi.fn(() => ({
    nowIndicator: null,
    gridRef,
    scrollToNow: vi.fn(),
  })),
}));

import GridView from './grid';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useNowIndicator } from '../hooks/useNowIndicator';
import { useDayClashes } from '@festie/shared/hooks';

function setFilters(overrides: Record<string, unknown> = {}) {
  const merged = { ...mockTimelineFilters, ...overrides };
  vi.mocked(useTimelineFilters).mockReturnValue(merged as unknown as ReturnType<typeof useTimelineFilters>);
  return merged;
}

const timedSet = { id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 };
const timedDay = {
  allDaySets: [timedSet],
  timedSets: [timedSet],
  timelessSets: [],
  visibleStages: [{ id: 'st1', name: 'Main Stage' }],
  timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
};

describe('GridView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(storeState).forEach((k) => delete storeState[k]);
    Object.assign(storeState, {
      stages: [{ id: 'st1', name: 'Main Stage' }],
      days: [{ index: 0, label: 'Friday', date: '2026-06-12' }],
      activeStages: [],
      festivals: [],
      error: null,
      isLoading: false,
      loadFestivals: vi.fn(),
      selectFestival: vi.fn(),
      searchQuery: '',
      onlyMine: false,
      currentProfile: null,
      setSearchQuery: vi.fn(),
      setOnlyMine: vi.fn(),
      setActiveStages: vi.fn(),
    });
    setFilters();
    vi.mocked(useDayClashes).mockReturnValue(noClashes);
    vi.mocked(useNowIndicator).mockReturnValue({
      nowIndicator: null,
      gridRef,
      scrollToNow: vi.fn(),
    });
  });

  it('renders without crashing', () => {
    const { container } = render(<GridView />);
    expect(container).toBeTruthy();
  });

  it('shows "No festival selected" when no festival is selected', () => {
    setFilters({ currentFestival: null });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
    expect(screen.getByText('Choose a festival on the Lineup tab to see the schedule grid.')).toBeInTheDocument();
  });

  it('shows the load error and a retry when the festival list failed', () => {
    storeState.error = 'Network down';
    setFilters({ currentFestival: null });
    render(<GridView />);
    expect(screen.getByText("Couldn't load festivals")).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('shows the TBA section with the "times aren\'t out yet" heading when only timeless sets exist', () => {
    setFilters({
      timedSets: [],
      timelessSets: [{ id: 's1', artist: 'TBA Artist', stageId: 'st1', dayIndex: 0 }],
    });
    render(<GridView />);
    expect(screen.getByRole('heading', { name: "Set times aren't out yet" })).toBeInTheDocument();
    expect(screen.getByText('TBA Artist')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Schedule grid' })).toBeInTheDocument();
  });

  it('shows "No sets scheduled" when allDaySets is empty and no timeless sets', () => {
    setFilters({
      allDaySets: [],
      timedSets: [],
      timelessSets: [],
      timeBounds: null,
    });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No sets scheduled for this day')).toBeInTheDocument();
  });

  it('blames My picks when it empties the day', () => {
    Object.assign(storeState, { sets: [], onlyMine: true, currentProfile: { picks: { other: 'must' } } });
    setFilters({ allDaySets: [], timedSets: [], timelessSets: [], timeBounds: null });
    render(<GridView />);
    expect(screen.getByText('No picks for this day yet')).toBeInTheDocument();
    expect(screen.getByText('Show all sets')).toBeInTheDocument();
  });

  it('shows "No sets scheduled" when timeBounds is null', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', dayIndex: 0 }],
      timedSets: [],
      timelessSets: [],
      timeBounds: null,
    });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No sets scheduled for this day')).toBeInTheDocument();
  });

  it('shows "All stages are filtered out" when no visible stages', () => {
    setFilters({ ...timedDay, visibleStages: [] });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('All stages are filtered out')).toBeInTheDocument();
  });

  it('honours the My picks filter (onlyMine)', async () => {
    const actual = await vi.importActual<typeof import('../hooks/useTimelineFilters')>('../hooks/useTimelineFilters');
    vi.mocked(useTimelineFilters).mockImplementation(actual.useTimelineFilters);
    Object.assign(storeState, {
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      sets: [{ id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      stages: [{ id: 'st1', name: 'Main Stage' }],
      selectedDay: 0,
      activeStages: [],
      onlyMine: false,
      // A pick elsewhere: the shared filter ignores My picks while there are no picks at all.
      currentProfile: { picks: { other: 'must' } },
    });
    try {
      // Control: without the filter the real hook places the set on the grid.
      const { unmount } = render(<GridView />);
      expect(screen.getByTestId('timeline-grid')).toBeInTheDocument();
      unmount();
      storeState.onlyMine = true;
      render(<GridView />);
      // The only pick is on another set, so nothing on this day shows.
      expect(screen.getByText('No picks for this day yet')).toBeInTheDocument();
      expect(screen.queryByTestId('timeline-grid')).not.toBeInTheDocument();
    } finally {
      for (const k of ['currentFestival', 'sets', 'stages', 'selectedDay', 'activeStages', 'onlyMine', 'currentProfile']) delete storeState[k];
    }
  });

  it('renders the grid, legend and toolbar when timed sets and visible stages exist', () => {
    setFilters(timedDay);
    render(<GridView />);
    expect(screen.getByTestId('timeline-grid')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-legend')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share grid as image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
  });

  it('renders the grid region with the "Schedule grid" label', () => {
    setFilters(timedDay);
    render(<GridView />);
    expect(screen.getByRole('region', { name: 'Schedule grid' })).toBeInTheDocument();
  });

  it('shows "Now" button when nowIndicator is present', () => {
    setFilters(timedDay);
    vi.mocked(useNowIndicator).mockReturnValue({
      nowIndicator: 50,
      gridRef,
      scrollToNow: vi.fn(),
    });
    render(<GridView />);
    expect(screen.getByLabelText('Scroll to the current time')).toBeInTheDocument();
    expect(screen.getByText('Jump to now')).toBeInTheDocument();
  });

  it('does not show "Now" button when nowIndicator is null', () => {
    setFilters(timedDay);
    render(<GridView />);
    expect(screen.queryByText('Jump to now')).not.toBeInTheDocument();
  });

  it('renders the TBA section alongside the grid when timeless sets exist', () => {
    setFilters({
      ...timedDay,
      timelessSets: [{ id: 's2', artist: 'TBA Artist', stageId: 'st1', dayIndex: 0 }],
    });
    render(<GridView />);
    expect(screen.getByTestId('timeline-grid')).toBeInTheDocument();
    expect(screen.getByText('TBA — Times Not Yet Announced')).toBeInTheDocument();
    expect(screen.queryByText("Set times aren't out yet")).not.toBeInTheDocument();
  });

  it('wraps content in RefreshableView', () => {
    setFilters(timedDay);
    render(<GridView />);
    expect(screen.getByTestId('refreshable-view')).toBeInTheDocument();
  });

  it('zooms out from 36px to 29px rows at a 1024px viewport', () => {
    expect(window.innerWidth).toBe(1024);
    setFilters(timedDay);
    render(<GridView />);
    const grid = screen.getByTestId('timeline-grid');
    expect(grid.style.gridTemplateRows).toContain('36px');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(grid.style.gridTemplateRows).toContain('29px');
  });

  describe('clash chip', () => {
    const alpha = { id: 'alpha', artist: 'Alpha', stageId: 'st1', startTime: '10:00', endTime: '11:00', dayIndex: 0 };
    const beta = { id: 'beta', artist: 'Beta', stageId: 'st2', startTime: '10:30', endTime: '11:30', dayIndex: 0 };
    const pick = (set: typeof alpha, start: number) => ({
      set: set as unknown as FestivalSet,
      priority: 'want-to-see' as const,
      startMs: start,
      endMs: start + 3_600_000,
      durationMin: 60,
    });
    const group: ConflictGroup = {
      picks: [pick(alpha, 0), pick(beta, 1_800_000)],
      recommendedKeepId: 'alpha',
      overlapMin: 30,
    };

    beforeEach(() => {
      mockNavigate.mockClear();
      vi.mocked(useDayClashes).mockReturnValue({ count: 1, marks: new Map(), groups: [group], picked: 2 });
    });

    it('opens Picks at the clash cards', () => {
      setFilters({ ...timedDay, allDaySets: [alpha, beta], timedSets: [alpha, beta] });
      render(<GridView />);
      fireEvent.click(screen.getByRole('button', { name: 'You have 1 schedule clash. Open it in Picks.' }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/picks', hash: 'clashes' });
    });
  });
});
