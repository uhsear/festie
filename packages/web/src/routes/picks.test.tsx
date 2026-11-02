import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@festie/shared/utils', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildPicksIcs: vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
  buildPicksShareUrl: vi.fn((profileId: string) => `https://festie.us/s/${profileId}`),
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

// OfflineReadinessCard, PickBulkActions, CrewSuggestionStrip, PicksPlanRow and
// PickConflicts have their own tests; stub them so PicksView tests stay focused
// on the plan (real stores + the real usePicksPlan drive the rows).
vi.mock('../components/features/OfflineReadinessCard', () => ({
  default: () => <div data-testid="offline-readiness-card" />,
}));
vi.mock('../components/features/CrewSuggestionStrip', () => ({ default: () => null }));
vi.mock('../components/PickBulkActions', () => ({ default: () => <div data-testid="bulk-actions" /> }));
vi.mock('../components/features/PicksPlanRow', () => ({
  default: ({ set }: { set: { artist: string } }) => <div data-testid="plan-row">{set.artist}</div>,
}));
vi.mock('../components/features/PickConflicts', () => ({
  default: ({ groups }: { groups?: unknown[] }) => <div data-testid="pick-conflicts">{groups?.length ?? 0}</div>,
}));

// Guests get the in-place teaser instead of a redirect; stub it so this suite
// stays focused on the authed picks UI.
vi.mock('../components/features/GuestTeaser', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="guest-teaser">{mode}</div>,
}));

const mockToast = vi.fn();
vi.mock('../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast, toastError: vi.fn(), toastUndo: vi.fn() }),
}));

import PicksView from './picks';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { buildPicksIcs } from '@festie/shared/utils';

const DAYS = [
  { id: 'd0', festivalId: 'f1', date: '2026-06-10', label: 'Day 1', createdAt: '', updatedAt: '' },
  { id: 'd1', festivalId: 'f1', date: '2026-06-11', label: 'Day 2', createdAt: '', updatedAt: '' },
];
const STAGES = [
  { id: 'st1', name: 'Main Stage' },
  { id: 'st2', name: 'Sahara' },
];

function makeSet(id: string, artist: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    festivalId: 'f1',
    artist,
    stageId: 'st1',
    startTime: '14:00',
    endTime: '15:00',
    dayIndex: 0,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

const picksOf = (picks: Record<string, string>) => ({ id: 'p1', userId: 'u1', picks, notes: {} });

interface StateOpts {
  user?: unknown;
  festival?: unknown;
  profile?: unknown;
  sets?: unknown[];
  selectedDay?: number;
}

function setStoreState(opts: StateOpts = {}) {
  const has = (k: keyof StateOpts) => k in opts;
  useAuthStore.setState({
    user: (has('user') ? opts.user : { id: 'u1', username: 'testuser' }) as never,
  });
  useFestivalStore.setState({
    currentFestival: (has('festival') ? opts.festival : { id: 'f1', name: 'Bonnaroo', timeZone: 'UTC' }) as never,
    currentFestivalId: 'f1',
    currentProfile: (has('profile') ? opts.profile : picksOf({})) as never,
    sets: (opts.sets ?? []) as never,
    stages: STAGES as never,
    days: DAYS as never,
    selectedDay: opts.selectedDay ?? 0,
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
    expect(screen.getByTestId('guest-teaser')).toHaveTextContent('picks');
  });

  it('shows "No festival selected" when no festival', () => {
    setStoreState({ festival: null });
    render(<PicksView />);
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
  });

  it('shows "No picks yet" when no profile', () => {
    setStoreState({ profile: null });
    render(<PicksView />);
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
  });

  it('shows "No picks yet" with no day name when the user has zero picks', () => {
    render(<PicksView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
    expect(screen.queryByText(/Day 1/)).toBeNull();
  });

  it('"Browse the lineup" CTA in empty state navigates to the schedule', () => {
    render(<PicksView />);
    fireEvent.click(screen.getByText('Browse the lineup'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('renders both day headers while the selected day is the other one', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { dayIndex: 1 })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
      selectedDay: 1,
    });
    render(<PicksView />);
    expect(screen.getByRole('button', { name: 'Day 1, 1 pick' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Day 2, 1 pick' })).toBeInTheDocument();
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
    expect(screen.getByText('Odesza')).toBeInTheDocument();
    expect(screen.queryByText(/No picks yet/)).toBeNull();
  });

  it('renders a pick on an unscheduled (TBA) set under Unscheduled', () => {
    setStoreState({
      sets: [
        makeSet('s1', 'Daft Punk'),
        makeSet('s2', 'Four Tet', { dayIndex: undefined, startTime: undefined, endTime: undefined }),
      ],
      profile: picksOf({ s1: 'must', s2: 'want-to-see' }),
    });
    render(<PicksView />);
    expect(screen.getByText('Four Tet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unscheduled, 1 pick' })).toBeInTheDocument();
  });

  it('the Must chip filters rows and toggles back to all', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '16:00', endTime: '17:00' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    render(<PicksView />);
    const group = screen.getByRole('group', { name: 'Filter picks' });
    fireEvent.click(within(group).getByRole('button', { name: /Must/ }));
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
    expect(screen.queryByText('Odesza')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: /Must/ }));
    expect(screen.getByText('Odesza')).toBeInTheDocument();
  });

  it('Headliners first lists the latest set first and Openers first restores it', () => {
    localStorage.clear();
    setStoreState({
      sets: [
        makeSet('s1', 'Early', { startTime: '22:00', endTime: '23:00' }),
        makeSet('s2', 'Late', { startTime: '01:00', endTime: '02:00' }),
      ],
      profile: picksOf({ s1: 'must', s2: 'must' }),
    });
    render(<PicksView />);
    const names = () => screen.getAllByTestId('plan-row').map((r) => r.textContent);
    expect(names()).toEqual(['Early', 'Late']);
    const order = screen.getByRole('radiogroup', { name: 'Order sets' });
    fireEvent.click(within(order).getByRole('radio', { name: 'Headliners first' }));
    expect(names()).toEqual(['Late', 'Early']);
    fireEvent.click(within(order).getByRole('radio', { name: 'Openers first' }));
    expect(names()).toEqual(['Early', 'Late']);
  });

  it('shows the clash chip only when picks overlap', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '14:30', endTime: '15:30' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    const { unmount } = render(<PicksView />);
    expect(screen.getByRole('button', { name: /Clashes/ })).toBeInTheDocument();
    expect(screen.getByTestId('pick-conflicts')).toHaveTextContent('1');
    unmount();

    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '16:00', endTime: '17:00' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    render(<PicksView />);
    expect(screen.queryByRole('button', { name: /Clashes/ })).toBeNull();
  });

  it('the search input filters by stage name', () => {
    setStoreState({
      sets: [
        makeSet('s1', 'Daft Punk'),
        makeSet('s2', 'Odesza', { stageId: 'st2', startTime: '16:00', endTime: '17:00' }),
      ],
      profile: picksOf({ s1: 'must', s2: 'must' }),
    });
    render(<PicksView />);
    fireEvent.change(screen.getByLabelText('Filter my picks'), { target: { value: 'sahara' } });
    expect(screen.getByText('Odesza')).toBeInTheDocument();
    expect(screen.queryByText('Daft Punk')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter my picks'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching picks')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('folding a day group hides its rows', () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    fireEvent.click(screen.getByRole('button', { name: 'Day 1, 1 pick' }));
    expect(screen.queryByText('Daft Punk')).toBeNull();
  });

  it('renders the region with aria-label "My picks"', () => {
    render(<PicksView />);
    expect(screen.getByRole('region', { name: 'My picks' })).toBeInTheDocument();
  });

  it('hides the calendar export button when the profile has no picks', () => {
    render(<PicksView />);
    expect(screen.queryByRole('button', { name: 'Add picks to calendar' })).toBeNull();
  });

  it('shows the calendar export button and downloads an .ics when clicked', () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });

    // jsdom lacks URL.createObjectURL/revokeObjectURL; stub them and the anchor
    // click so the download path runs without a real navigation.
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<PicksView />);
    const btn = screen.getByRole('button', { name: 'Add picks to calendar' });
    expect(btn).toBeInTheDocument();
    btn.click();

    expect(buildPicksIcs).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it('shares picks via navigator.share when available', async () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk')],
      profile: picksOf({ s1: 'must' }),
    });

    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true, writable: true });

    render(<PicksView />);
    const btn = screen.getByRole('button', { name: 'Share my picks' });
    btn.click();
    // handleSharePicks is async; let the awaited share settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({
      title: 'My Bonnaroo picks on Festie',
      text: 'My Bonnaroo picks on Festie',
      url: 'https://festie.us/s/p1',
    });

    // Cleanup so the fallback test sees navigator.share as undefined.
    delete (navigator as { share?: unknown }).share;
  });

  it('falls back to clipboard + toast when navigator.share is undefined', async () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk')],
      profile: picksOf({ s1: 'must' }),
    });

    // Ensure no native share is present so we exercise the desktop fallback.
    delete (navigator as { share?: unknown }).share;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });

    render(<PicksView />);
    const btn = screen.getByRole('button', { name: 'Share my picks' });
    btn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('https://festie.us/s/p1');
    expect(mockToast).toHaveBeenCalledWith('Share link copied to clipboard', 'success');
  });
});
