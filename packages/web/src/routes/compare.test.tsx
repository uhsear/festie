import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompareView from './compare';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  crewState: { status: 'ready', crew: { id: 'c1', name: 'Sam Crew' }, crews: [], retry: vi.fn() },
  festState: { state: 'match', festivalName: 'Forbidden Kingdom', retry: vi.fn() },
  compare: vi.fn(),
  strip: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()),
  savePick: vi.fn(() => Promise.resolve()),
  toastError: vi.fn(),
  days: [
    { id: 'd0', date: '2026-11-06', label: 'Friday' },
    { id: 'd1', date: '2026-11-07', label: 'Saturday' },
  ] as unknown[],
}));

const SET = { id: 's1', stageId: 'st', artist: 'Daft Punk', startTime: '14:00', endTime: '15:00' };

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: mocks.user }),
  useFestivalStore: (sel: (s: unknown) => unknown) => sel({ currentFestival: { id: 'f1' }, days: mocks.days, selectedDay: 1 }),
}));
vi.mock('@festie/shared/hooks', () => ({
  useActiveCrew: () => mocks.crewState,
  useCrewFestival: () => mocks.festState,
  useCrewCompare: (sort: string) => mocks.compare(sort),
  useFestival: () => ({ getStageColor: () => '#fff', getStageName: () => 'Main' }),
  usePicks: () => ({ savePick: mocks.savePick }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#test">{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toastError: mocks.toastError }) }));
vi.mock('../components/features/GuestTeaser', () => ({ default: () => <div>guest-teaser</div> }));
vi.mock('../components/features/CrewSuggestionStrip', () => ({
  default: (p: { title?: string }) => {
    mocks.strip(p);
    return null;
  },
}));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../hooks/useAnimatedNumber', () => ({ useAnimatedNumber: (n: number) => n }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'u1' };
  mocks.savePick.mockImplementation(() => Promise.resolve());
  mocks.crewState = { status: 'ready', crew: { id: 'c1', name: 'Sam Crew' }, crews: [], retry: vi.fn() };
  mocks.festState = { state: 'match', festivalName: 'Forbidden Kingdom', retry: vi.fn() };
  mocks.compare.mockReturnValue({
    columns: [
      { profileId: 'p1', userId: 'u1', name: 'Alice', isMe: true, color: 'rgb(1, 2, 3)' },
      { profileId: 'p2', userId: 'u2', name: 'Bob', isMe: false, color: 'rgb(4, 5, 6)' },
    ],
    rows: [{ set: SET, picks: { p1: undefined, p2: 'must' }, pickers: 1, topPriority: 'must', mine: undefined }],
    freeTogether: [],
    split: [],
    together: [],
    notThere: [],
    timeZone: 'UTC',
  });
});

describe('CompareView', () => {
  it('names members who are not there on the selected day', () => {
    mocks.compare.mockReturnValue({
      ...mocks.compare(),
      notThere: [
        { profileId: 'p3', userId: 'u3', name: 'Ana', isMe: false, color: 'x' },
        { profileId: 'p4', userId: 'u4', name: 'Ben', isMe: false, color: 'x' },
      ],
    });
    render(<CompareView />);
    expect(screen.getByText('Not there Saturday: Ana, Ben')).toBeInTheDocument();
  });

  it('shows no not-there line when everyone is there', () => {
    render(<CompareView />);
    expect(screen.queryByText(/Not there/)).not.toBeInTheDocument();
  });

  it('shows the guest teaser when signed out', () => {
    mocks.user = null;
    render(<CompareView />);
    expect(screen.getByText('guest-teaser')).toBeInTheDocument();
  });

  it('shows a loading line while the crew loads', () => {
    mocks.crewState = { ...mocks.crewState, status: 'loading', crew: null as never };
    render(<CompareView />);
    expect(screen.getByText('Loading your crew…')).toBeInTheDocument();
  });

  it('shows Try again on error and calls retry', () => {
    mocks.crewState = { ...mocks.crewState, status: 'error', crew: null as never };
    render(<CompareView />);
    expect(screen.getByText("Couldn't load your crew")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.crewState.retry).toHaveBeenCalled();
  });

  it('shows "No crew yet" with no crews', () => {
    mocks.crewState = { ...mocks.crewState, status: 'none', crew: null as never };
    render(<CompareView />);
    expect(screen.getByText('No crew yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create or join a crew' })).toBeInTheDocument();
  });

  it('says which festival it is opening while switching', () => {
    mocks.festState = { ...mocks.festState, state: 'switching' };
    render(<CompareView />);
    expect(screen.getByText('Opening Forbidden Kingdom…')).toBeInTheDocument();
  });

  it('offers retry when the festival switch fails', () => {
    mocks.festState = { ...mocks.festState, state: 'failed' };
    render(<CompareView />);
    expect(screen.getByText("Couldn't open Forbidden Kingdom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.festState.retry).toHaveBeenCalled();
  });

  it('names crew, festival and members in the header and renders artists', () => {
    render(<CompareView />);
    expect(screen.getByText(/Sam Crew · Forbidden Kingdom · 2 members/)).toBeInTheDocument();
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('toasts when adding a pick fails', async () => {
    mocks.savePick.mockImplementation(() => Promise.reject(new Error('Network request failed')));
    render(<CompareView />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Daft Punk to my picks' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.any(Error), "Couldn't save your pick. Try again."));
  });

  it('passes the new title to the suggestion strip', () => {
    render(<CompareView />);
    expect(mocks.strip).toHaveBeenCalledWith({ title: "Your crew is seeing, you're missing" });
  });

  it('sorts by Most picked', () => {
    render(<CompareView />);
    expect(mocks.compare).toHaveBeenLastCalledWith('time');
    fireEvent.click(screen.getByRole('button', { name: 'Most picked' }));
    expect(mocks.compare).toHaveBeenLastCalledWith('mix');
    expect(screen.getByRole('button', { name: 'Most picked' })).toHaveAttribute('aria-pressed', 'true');
  });
});
