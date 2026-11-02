import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// Track store state that selectors read from
const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: Object.assign(vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)), { subscribe: vi.fn() }),
}));

vi.mock('@festie/shared/hooks', () => ({
  usePicks: vi.fn(() => ({
    getMyPick: vi.fn(() => null),
    savePick: vi.fn(),
    getMyNote: vi.fn(() => ''),
  })),
  useFestival: vi.fn(() => ({
    getStageColor: vi.fn(() => '#ccc'),
    getStageName: vi.fn(() => 'Main Stage'),
  })),
  useCrewNudges: vi.fn(() => []),
}));

vi.mock('@festie/shared/utils', () => ({
  formatTime: vi.fn((t: string) => t),
  artistDisplayName: vi.fn((set: { artist?: string }) => set.artist || 'Unknown'),
  buildPicksIcsExport: vi.fn(() => ({ ics: 'BEGIN:VCALENDAR', timed: 1, timeTba: 0, skipped: 0 })),
  describeIcsExport: vi.fn(() => 'Added 1 set to your calendar file.'),
  resolveStageColor: (c: string | null | undefined, fallback: string) => c || fallback,
  // Mirrors the real @festie/shared/utils/setStatus.isSetScheduled: a set is
  // scheduled only when dayIndex resolves to a real position in `days`.
  isSetScheduled: (set: { dayIndex?: number }, days: unknown[]) =>
    typeof set.dayIndex === 'number' && set.dayIndex >= 0 && set.dayIndex < days.length,
}));

vi.mock('../components/ui/StageBadge', () => ({
  default: ({ stageName }: { stageName: string }) => <span data-testid="stage-badge">{stageName}</span>,
}));

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

// OfflineReadinessCard (F5) has its own render test; stub it here so PicksView
// tests stay focused and don't need its store mocks / lucide icons.
vi.mock('../components/features/OfflineReadinessCard', () => ({
  default: () => <div data-testid="offline-readiness-card" />,
}));

// PickConflicts has its own render test; stub it so PicksView tests don't need
// its crew-store mocks / extra lucide icons / shared buildPickConflicts mock.
vi.mock('../components/features/PickConflicts', () => ({
  default: () => <div data-testid="pick-conflicts" />,
}));

// Guests get the in-place teaser instead of a redirect; stub it so this suite
// stays focused on the authed picks UI.
vi.mock('../components/features/GuestTeaser', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="guest-teaser">{mode}</div>,
}));

vi.mock('lucide-react', () => ({
  Star: () => <span data-testid="star-icon" />,
  Heart: () => <span data-testid="heart-icon" />,
  Circle: () => <span data-testid="circle-icon" />,
  CalendarX: () => <span data-testid="calendar-x-icon" />,
  UserPlus: () => <span data-testid="user-plus-icon" />,
  CalendarPlus: () => <span data-testid="calendar-plus-icon" />,
  Share2: () => <span data-testid="share-icon" />,
  X: () => <span data-testid="x-icon" />,
  Sparkles: () => <span data-testid="sparkles-icon" />,
  Layers: () => <span data-testid="layers-icon" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
}));

// SharePicksDialog has its own test (it needs router, crew store and QR mocks).
vi.mock('../components/features/SharePicksDialog', () => ({
  default: () => <button type="button" aria-label="Share my picks">Share picks</button>,
}));

const mockToast = vi.fn();
vi.mock('../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast, toastError: vi.fn() }),
}));

import PicksView from './picks';
import { usePicks } from '@festie/shared/hooks';
import { buildPicksIcsExport, describeIcsExport } from '@festie/shared/utils';

function setStoreState(overrides: Record<string, unknown> = {}) {
  // Clear and repopulate the shared state object
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    user: { id: 'u1', username: 'testuser' },
    currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined },
    currentProfile: { picks: {}, notes: {} },
    sets: [],
    stages: [],
    days: [{ date: '2026-06-10', label: 'Day 1' }],
    selectedDay: 0,
    setDetailSet: vi.fn(),
    ...overrides,
  });
}

describe('PicksView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it('renders the guest teaser when no user', () => {
    setStoreState({ user: null });
    render(<PicksView />);
    // Guests see <GuestTeaser mode="picks"/> in place of the picks UI.
    expect(screen.getByTestId('guest-teaser')).toHaveTextContent('picks');
  });

  it('shows "No festival selected" when no festival', () => {
    setStoreState({ currentFestival: null });
    render(<PicksView />);
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
  });

  it('shows "No picks yet" when no profile', () => {
    setStoreState({ currentProfile: null });
    render(<PicksView />);
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
  });

  it('shows empty state when user has zero picks for the day', () => {
    setStoreState();
    render(<PicksView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText(/No picks yet/)).toBeInTheDocument();
  });

  it('"Browse the lineup" CTA in empty state navigates to the schedule', () => {
    setStoreState();
    render(<PicksView />);
    fireEvent.click(screen.getByText('Browse the lineup'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('renders pick sections when user has picks', () => {
    const sets = [
      { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 },
      { id: 's2', artist: 'Odesza', stageId: 'st2', startTime: '16:00', dayIndex: 0 },
    ];
    setStoreState({ sets });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn((id: string) => {
        if (id === 's1') return 'must';
        if (id === 's2') return 'maybe';
        return null;
      }),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    render(<PicksView />);
    expect(screen.getByText('Must See')).toBeInTheDocument();
    expect(screen.getByText('Want to See')).toBeInTheDocument();
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('shows the heart glyph, not the word diamond, in an empty Want bucket', () => {
    setStoreState({
      sets: [{ id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 }],
    });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn((id: string) => (id === 's1' ? 'must' : null)),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    const { container } = render(<PicksView />);
    const hint = screen.getByText(/on sets you'd like to catch/).closest('p')!;
    expect(within(hint).getByTestId('heart-icon')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/diamond/i);
  });

  it('renders a pick on an unscheduled (TBA) set regardless of the selected day', () => {
    // s2 has no dayIndex (schedule not yet announced) — it must never be
    // filtered out by the `dayIndex === selectedDay` day check, or the pick
    // becomes permanently invisible/unremovable on every day tab.
    const sets = [
      { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 },
      { id: 's2', artist: 'Four Tet', stageId: 'st2' },
    ];
    setStoreState({ sets, selectedDay: 0, days: [{ date: '2026-06-10', label: 'Day 1' }] });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn((id: string) => {
        if (id === 's1') return 'must';
        if (id === 's2') return 'want-to-see';
        return null;
      }),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    render(<PicksView />);
    expect(screen.getByText('Four Tet')).toBeInTheDocument();
  });

  it('renders pick items with artist names', () => {
    const sets = [{ id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 }];
    setStoreState({ sets });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn(() => 'must'),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    render(<PicksView />);
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('renders the region with aria-label "My picks"', () => {
    render(<PicksView />);
    expect(screen.getByRole('region', { name: 'My picks' })).toBeInTheDocument();
  });

  it('hides the calendar export button when the profile has no picks', () => {
    // hasAnyPicks reads currentProfile.picks directly — empty map → no button.
    setStoreState();
    render(<PicksView />);
    expect(screen.queryByRole('button', { name: 'Add picks to calendar' })).toBeNull();
  });

  it('shows the calendar button and downloads an .ics via Download once', async () => {
    const sets = [
      {
        id: 's1',
        artist: 'Daft Punk',
        stageId: 'st1',
        startTime: '14:00',
        endTime: '15:00',
        date: '2026-06-10',
        dayIndex: 0,
      },
    ];
    setStoreState({ sets, currentProfile: { picks: { s1: 'must' }, notes: {} } });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn(() => 'must'),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });

    // jsdom lacks URL.createObjectURL/revokeObjectURL; stub them and the anchor
    // click so the download path runs without a real navigation.
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<PicksView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add picks to calendar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download once' }));

    expect(buildPicksIcsExport).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(describeIcsExport).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Added 1 set to your calendar file.', 'success');

    clickSpy.mockRestore();
  });

  it('renders the Share picks button when the profile has picks', async () => {
    const sets = [{ id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 }];
    setStoreState({ sets, currentProfile: { id: 'p1', picks: { s1: 'must' }, notes: {} } });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn(() => 'must'),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    render(<PicksView />);
    expect(await screen.findByRole('button', { name: 'Share my picks' })).toBeInTheDocument();
  });
});
