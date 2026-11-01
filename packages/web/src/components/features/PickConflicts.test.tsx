import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConflictGroup } from '@festie/shared/utils';

// Track store state that selectors read from.
const festivalState: Record<string, unknown> = {};
const crewState: Record<string, unknown> = {};
const uiState: Record<string, unknown> = {};

const resolver = {
  splitPlan: vi.fn<() => unknown>(() => null),
  plannedSplit: vi.fn<() => string | null>(() => null),
  keep: vi.fn(),
  split: vi.fn(),
  clearSplit: vi.fn(),
};
const toast = vi.fn();
const toastUndo = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastUndo, toastError }) }));

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));

vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(uiState)),
}));

vi.mock('@festie/shared/hooks', () => ({
  useClashResolver: () => resolver,
  useFestival: vi.fn(() => ({
    getStageName: vi.fn((id: string) => (id === 'st1' ? 'Main Stage' : 'Sahara')),
    getStageColor: vi.fn(() => '#00e8d0'),
  })),
}));

// buildPickConflicts is the pure shared util; mock it at the boundary so each
// test drives the rendered output deterministically. Pass through the other
// utils the component imports.
const buildPickConflicts = vi.fn<() => ConflictGroup[]>(() => []);
vi.mock('@festie/shared/utils', () => ({
  buildPickConflicts: (...args: unknown[]) => buildPickConflicts(...(args as [])),
  artistDisplayName: vi.fn((set: { artist?: string }) => set.artist || 'Unknown'),
  formatTime: vi.fn((t: string) => t),
  fmtDurationMinutes: (m: number) => `${m} min`,
  resolveStageColor: (c: string | null | undefined, fallback: string) => c || fallback,
}));

vi.mock('../ui/StageBadge', () => ({
  default: ({ stageName }: { stageName: string }) => <span data-testid="stage-badge">{stageName}</span>,
}));

vi.mock('lucide-react', () => ({
  CalendarClock: () => <span data-testid="calendar-clock-icon" />,
  TriangleAlert: () => <span data-testid="triangle-alert-icon" />,
  Loader: () => <span />,
  Star: () => <span />,
  Heart: () => <span />,
  Circle: () => <span />,
}));

import PickConflicts from './PickConflicts';

function makeSet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    festivalId: 'f1',
    stageId: 'st1',
    artist: `Artist ${id}`,
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setState() {
  Object.keys(festivalState).forEach((k) => delete festivalState[k]);
  Object.assign(festivalState, {
    sets: [makeSet('s1'), makeSet('s2', { artist: 'Odesza', startTime: '14:30', endTime: '15:30' })],
    days: [{ date: '2026-06-10', label: 'Day 1' }],
    stages: [],
    selectedDay: 0,
    currentProfile: { userId: 'u1', picks: { s1: 'must', s2: 'want-to-see' } },
    currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined, timeZone: 'UTC' },
    allProfiles: [],
  });
  Object.keys(crewState).forEach((k) => delete crewState[k]);
  Object.assign(crewState, { activeCrew: null, crewMembers: [] });
  Object.keys(uiState).forEach((k) => delete uiState[k]);
  Object.assign(uiState, { setDetailSet: vi.fn() });
}

function twoPickGroup(extra: Partial<ConflictGroup> = {}): ConflictGroup {
  return {
    picks: [
      { set: makeSet('s1') as never, priority: 'must', startMs: 0, endMs: 3_600_000, durationMin: 60 },
      {
        set: makeSet('s2', { artist: 'Odesza', startTime: '14:30', endTime: '15:30' }) as never,
        priority: 'want-to-see',
        startMs: 1_800_000,
        endMs: 5_400_000,
        durationMin: 60,
      },
    ],
    recommendedKeepId: 's1',
    overlapMin: 30,
    pairs: [],
    tight: false,
    ...extra,
  };
}

describe('PickConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPickConflicts.mockReturnValue([]);
    resolver.splitPlan.mockReturnValue(null);
    resolver.plannedSplit.mockReturnValue(null);
    resolver.keep.mockResolvedValue({ message: 'Kept A.', undo: vi.fn() });
    resolver.split.mockResolvedValue({ message: 'Split plan saved.', undo: vi.fn() });
    setState();
  });

  it('renders nothing when there are no conflict groups', () => {
    const { container } = render(<PickConflicts />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a clash card when two picks overlap', () => {
    buildPickConflicts.mockReturnValue([twoPickGroup()]);
    render(<PickConflicts />);
    expect(screen.getByText('Schedule clash')).toBeInTheDocument();
    expect(screen.getByText(/30 min overlap/)).toBeInTheDocument();
    expect(screen.getByText('Artist s1')).toBeInTheDocument();
    expect(screen.getByText('Odesza')).toBeInTheDocument();
    expect(screen.getByText('Suggested')).toBeInTheDocument();
  });

  it('opens the set detail when the artist name is clicked', async () => {
    const user = userEvent.setup();
    const setDetailSet = vi.fn();
    uiState.setDetailSet = setDetailSet;
    buildPickConflicts.mockReturnValue([twoPickGroup()]);

    render(<PickConflicts />);
    await user.click(screen.getByLabelText('Open details for Artist s1'));
    expect(setDetailSet).toHaveBeenCalledTimes(1);
  });

  it('Keep calls the resolver with the pick id and shows an undo toast', async () => {
    const user = userEvent.setup();
    buildPickConflicts.mockReturnValue([twoPickGroup()]);
    render(<PickConflicts />);
    await user.click(screen.getByRole('button', { name: 'Keep Odesza and remove the other pick' }));
    expect(resolver.keep).toHaveBeenCalledWith(expect.anything(), 's2');
    expect(toastUndo).toHaveBeenCalledWith('Kept A.', expect.any(Function));
  });

  it('shows the failure message when Keep rejects', async () => {
    const user = userEvent.setup();
    const failure = new Error('');
    resolver.keep.mockRejectedValue(failure);
    buildPickConflicts.mockReturnValue([twoPickGroup()]);
    render(<PickConflicts />);
    await user.click(screen.getByRole('button', { name: /^Keep Odesza/ }));
    expect(toastError).toHaveBeenCalledWith(failure, "Couldn't update your picks. Try again.");
  });

  it('shows Split only when a split plan exists', () => {
    buildPickConflicts.mockReturnValue([twoPickGroup()]);
    const { unmount } = render(<PickConflicts />);
    expect(screen.queryByRole('button', { name: /^Split/ })).toBeNull();
    unmount();
    resolver.splitPlan.mockReturnValue({ sentence: 'See the first 24 min of A.' });
    render(<PickConflicts />);
    expect(screen.getByRole('button', { name: 'Split: See the first 24 min of A.' })).toBeInTheDocument();
  });

  it('shows Split for a staggered pair and no Split for a contained pair', async () => {
    const { buildSplitPlan } = await vi.importActual<typeof import('@festie/shared/utils')>('@festie/shared/utils');
    resolver.splitPlan.mockImplementation(((g: ConflictGroup) =>
      buildSplitPlan(g, { timeZone: 'UTC', stageName: () => 'Main Stage' })) as never);

    buildPickConflicts.mockReturnValue([twoPickGroup()]);
    const { unmount } = render(<PickConflicts />);
    expect(screen.getByRole('button', { name: /^Split: / })).toBeInTheDocument();
    unmount();

    const contained = twoPickGroup();
    contained.picks[1] = { ...contained.picks[1], startMs: 900_000, endMs: 2_700_000, durationMin: 30 };
    buildPickConflicts.mockReturnValue([contained]);
    render(<PickConflicts />);
    expect(screen.queryByRole('button', { name: /^Split/ })).toBeNull();
  });

  it('renders a tight change with gap and walk meta', () => {
    buildPickConflicts.mockReturnValue([
      twoPickGroup({
        tight: true,
        overlapMin: 0,
        pairs: [{ gapMinutes: 5, walkMinutes: 14, overlapMinutes: 0, tight: true } as never],
      }),
    ]);
    render(<PickConflicts />);
    expect(screen.getByText('Tight change')).toBeInTheDocument();
    expect(screen.getByText('5 min gap · 14 min walk')).toBeInTheDocument();
  });

  it('shows Split planned and Clear plan for a saved plan', async () => {
    const user = userEvent.setup();
    resolver.plannedSplit.mockReturnValue('See all of A.');
    resolver.clearSplit.mockResolvedValue({ message: 'Split plan removed.', undo: vi.fn() });
    buildPickConflicts.mockReturnValue([twoPickGroup()]);
    render(<PickConflicts />);
    expect(screen.getByText('Split planned')).toBeInTheDocument();
    expect(screen.getByText('See all of A.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear plan' }));
    expect(resolver.clearSplit).toHaveBeenCalled();
  });
});
