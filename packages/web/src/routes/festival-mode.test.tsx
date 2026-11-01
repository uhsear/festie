import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CrewDayOf } from '@festie/shared/hooks';

const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

let state: Record<string, unknown> = {};
let authUser: { id: string } | null = null;
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: Record<string, unknown>) => unknown) => selector(state),
  useAuthStore: (selector: (s: { user: unknown }) => unknown) => selector({ user: authUser }),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector({ setDetailSet: vi.fn() }), { subscribe: vi.fn() }),
}));

let crewDayOf: CrewDayOf = { crew: null, whereabouts: [], meet: null };
vi.mock('@festie/shared/hooks', () => ({
  useFestival: () => ({ getStageName: () => 'Main Stage' }),
  useCrewDayOf: () => crewDayOf,
}));

vi.mock('../components/crew/SosRaiseButton', () => ({
  default: ({ crewId }: { crewId: string }) => <button data-testid="sos-raise">{crewId}</button>,
}));
vi.mock('../components/features/LowPowerToggle', () => ({ default: () => <div data-testid="low-power-toggle" /> }));
vi.mock('../components/features/LowPowerIndicator', () => ({ default: () => null }));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import FestivalModeView from './festival-mode';

// UTC festival zone keeps every assertion independent of the host zone.
const FESTIVAL = { id: 'f1', name: 'Bonnaroo 2026', timeZone: 'UTC' };
const DAYS = [
  { id: 'd0', date: '2026-06-12' },
  { id: 'd1', date: '2026-06-13' },
];
const SETS = [
  { id: 's1', artist: 'Odesza', stageId: 'main', dayIndex: 0, startTime: '17:00', endTime: '18:00' },
  { id: 's2', artist: 'Fred again..', stageId: 'main', dayIndex: 0, startTime: '19:00', endTime: '20:30' },
  { id: 's3', artist: 'Bicep', stageId: 'main', dayIndex: 1, startTime: '21:00', endTime: '22:00' },
];

function setup(opts: { festival?: unknown; picks?: Record<string, string> | null; user?: boolean } = {}) {
  state = {
    currentFestival: opts.festival === undefined ? FESTIVAL : opts.festival,
    sets: SETS,
    days: DAYS,
    currentProfile: opts.picks === null ? null : { picks: opts.picks ?? {} },
  };
  authUser = opts.user ? { id: 'me' } : null;
}

describe('FestivalModeView (Now surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T17:30:00Z'));
    crewDayOf = { crew: null, whereabouts: [], meet: null };
  });
  afterEach(() => vi.useRealTimers());

  it('asks for a festival when none is selected', () => {
    setup({ festival: null });
    render(<FestivalModeView />);
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a festival' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('guest: shows what is live on the lineup and a sign-in prompt for crew', () => {
    setup({ user: false });
    render(<FestivalModeView />);
    expect(screen.getByText('Now on the lineup')).toBeInTheDocument();
    expect(screen.getByTestId('fm-now-card')).toHaveTextContent('Odesza');
    expect(screen.getByTestId('fm-now-card')).toHaveTextContent('until 6:00 PM');
    expect(screen.getByTestId('fm-now-card')).toHaveTextContent('30m left');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
    expect(screen.getByLabelText('Festival time')).toHaveTextContent('5:30 PM');
  });

  it('signed in: shows the next pick with a countdown and where to walk', () => {
    setup({ user: true, picks: { s2: 'must', s3: 'maybe' } });
    render(<FestivalModeView />);
    const hero = screen.getByTestId('fm-next-hero');
    expect(hero).toHaveTextContent('Fred again..');
    expect(hero).toHaveTextContent('Head to Main Stage');
    expect(hero).toHaveTextContent('in 1h 30m');
    // The hero holds the first upcoming pick; the list holds the rest.
    expect(screen.getAllByTestId('fm-next-card')).toHaveLength(1);
    expect(screen.getByText('No crew yet')).toBeInTheDocument();
  });

  it('signed in with no picks today: says so and offers the lineup', () => {
    setup({ user: true, picks: { s3: 'must' } });
    render(<FestivalModeView />);
    expect(screen.getByText('No picks today')).toBeInTheDocument();
    expect(screen.getByText(/Your next pick is Bicep, Sat 9:00 PM/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fm-browse'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('before the festival: shows when it starts', () => {
    vi.setSystemTime(new Date('2026-06-09T12:00:00Z'));
    setup({ user: true, picks: { s1: 'must' } });
    render(<FestivalModeView />);
    expect(screen.getByText('Starts Fri 5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('In 4 days.')).toBeInTheDocument();
  });

  it('signed in with a crew: shows who is where and the meeting point, one tap to Meet', () => {
    setup({ user: true, picks: { s1: 'must' } });
    crewDayOf = {
      crew: { id: 'c1', name: 'Night Owls', owner: 'me', members: [], createdAt: '', updatedAt: '' },
      whereabouts: [
        { userId: 'a', name: 'Ana', statusLabel: 'Here · Big tree', statusAt: null, live: 'live', liveAt: null, sos: false },
      ],
      meet: { kind: 'meeting-point', id: 'mp1', label: 'Big tree', location: 'Left of Main', atMs: null, timeText: null },
    };
    render(<FestivalModeView />);
    expect(screen.getByTestId('fm-crew')).toHaveTextContent('Ana');
    expect(screen.getByTestId('fm-crew')).toHaveTextContent('Live');
    expect(screen.getByTestId('fm-meet')).toHaveTextContent('Left of Main');
    expect(screen.getByTestId('sos-raise')).toHaveTextContent('c1');
    fireEvent.click(screen.getByTestId('fm-find-crew'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/crew' });
  });

  it('guest or no crew: shows no SOS button', () => {
    setup({ user: false });
    const { unmount } = render(<FestivalModeView />);
    expect(screen.queryByTestId('sos-raise')).not.toBeInTheDocument();
    unmount();
    setup({ user: true });
    render(<FestivalModeView />);
    expect(screen.queryByTestId('sos-raise')).not.toBeInTheDocument();
  });
});
