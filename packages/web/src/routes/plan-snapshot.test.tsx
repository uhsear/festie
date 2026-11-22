import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encodePlanSnapshot } from '@festie/shared/utils';

const apiGet = vi.fn();
const toast = vi.fn();
const toastUndo = vi.fn();
const toastError = vi.fn();
const bulkSavePicks = vi.fn();
const restorePicks = vi.fn();
const selectFestival = vi.fn();

// Mutable store state: each test sets who is signed in and which plan is loaded.
const authState: { user: { id: string } | null } = { user: null };
const festivalState: Record<string, unknown> = {};

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children, ...rest }: { to: string; search?: { next?: string }; children: React.ReactNode }) => (
    <a href={search?.next ? `${to}?next=${encodeURIComponent(search.next)}` : to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@festie/shared/services', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
  isApiClientError: (err: unknown) => !!err && typeof err === 'object' && 'status' in err,
}));

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (select: (s: typeof authState) => unknown) => select(authState),
  useFestivalStore: Object.assign((select: (s: typeof festivalState) => unknown) => select(festivalState), {
    getState: () => ({ ...festivalState, bulkSavePicks, restorePicks, selectFestival }),
  }),
}));

vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast, toastUndo, toastError }) }));

import PlanSnapshotPage from './plan-snapshot';

const festival = {
  id: 'fest-1',
  name: 'Live Fest',
  stages: [{ id: 'st-1', name: 'Main Stage' }],
  days: [
    {
      id: 'd1',
      date: '2026-07-10',
      label: 'Friday',
      sets: [{ id: 'set-1', stageId: 'st-1', startTime: '21:30', endTime: '22:30', artist: 'Aurora' }],
    },
  ],
};

function setHash(hash: string) {
  window.location.hash = hash;
}

function snapshotHash(picks: Array<{ setId: string; priority: 'must' | 'want' | 'maybe' }>, withMeet = false) {
  return encodePlanSnapshot({
    festivalId: 'fest-1',
    festivalName: 'Snap Fest',
    picks,
    ...(withMeet ? { meetingPoint: { label: 'North gate', lat: 1.5, lng: 2.5 } } : {}),
  });
}

describe('PlanSnapshotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockReset();
    setHash('');
    sessionStorage.clear();
    authState.user = null;
    for (const key of Object.keys(festivalState)) delete festivalState[key];
    Object.assign(festivalState, { currentFestivalId: null, currentProfile: null, sets: [], isLoading: false, error: null });
    bulkSavePicks.mockImplementation(async (ids: string[]) => ids.length);
    restorePicks.mockResolvedValue(undefined);
  });

  it('orders days by the festival and rows by start time, not by priority', async () => {
    apiGet.mockResolvedValue({
      ...festival,
      days: [
        { id: 'd1', date: '2026-07-10', label: 'Friday', sets: [
          { id: 'a', stageId: 'st-1', startTime: '22:00', artist: 'Late' },
          { id: 'b', stageId: 'st-1', startTime: '18:00', artist: 'Early' },
        ] },
        { id: 'd2', date: '2026-07-11', label: 'Saturday', sets: [{ id: 'c', stageId: 'st-1', startTime: '20:00', artist: 'Sat' }] },
      ],
    });
    setHash(snapshotHash([
      { setId: 'c', priority: 'must' },
      { setId: 'a', priority: 'want' },
      { setId: 'b', priority: 'maybe' },
    ]));
    render(<PlanSnapshotPage />);
    await screen.findByText('Early');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Friday', 'Saturday']);
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Early')).toBeLessThan(text.indexOf('Late'));
  });

  it('renders picks by day from the festival, with the meeting point link', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(snapshotHash([{ setId: 'set-1', priority: 'must' }], true));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('Aurora')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live Fest' })).toBeInTheDocument();
    expect(screen.getByText('Friday')).toBeInTheDocument();
    expect(screen.getByText(/Main Stage/)).toHaveTextContent('Must See');
    expect(screen.getByRole('link', { name: 'Meet at North gate' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=1.5,2.5',
    );
    expect(apiGet).toHaveBeenCalledWith('/festivals/fest-1');
  });

  it.each(['', 'garbage!!', 'a'.repeat(5000)])('shows the unreadable state for hash %#', (hash) => {
    setHash(hash);
    render(<PlanSnapshotPage />);
    expect(screen.getByText("This plan code can't be read")).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('shows the snapshot name, count and offline line when the fetch fails', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    setHash(snapshotHash([{ setId: 'set-1', priority: 'want' }]));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('Connect to the internet to see set names and times.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Snap Fest' })).toBeInTheDocument();
    expect(screen.getByText(/1 set$/)).toBeInTheDocument();
  });

  it('counts picks missing from the lineup', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(
      snapshotHash([
        { setId: 'set-1', priority: 'must' },
        { setId: 'gone-1', priority: 'maybe' },
        { setId: 'gone-2', priority: 'maybe' },
      ]),
    );
    render(<PlanSnapshotPage />);
    await waitFor(() => expect(screen.getByText('2 picks are no longer in the lineup.')).toBeInTheDocument());
    expect(screen.getByText(/1 set$/)).toBeInTheDocument();
  });

  it('says the festival is gone on a 404, not that the viewer is offline', async () => {
    apiGet.mockRejectedValue({ status: 404 });
    setHash(snapshotHash([{ setId: 'set-1', priority: 'want' }]));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('This festival is no longer available.')).toBeInTheDocument();
    expect(screen.queryByText('Connect to the internet to see set names and times.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Add to my plan' })).toBeNull();
    expect(screen.getByText(/0 sets$/)).toBeInTheDocument();
  });

  it('renders the Plan B line from a v2 code', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(
      encodePlanSnapshot({
        festivalId: 'fest-1',
        festivalName: 'Snap Fest',
        picks: [{ setId: 'set-1', priority: 'must' }],
        planB: 'Top of the hour',
      }),
    );
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('If we lose each other: Top of the hour')).toBeInTheDocument();
  });

  it('renders a v1 code without a Plan B line', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(snapshotHash([{ setId: 'set-1', priority: 'must' }]));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('Aurora')).toBeInTheDocument();
    expect(screen.queryByText(/If we lose each other/)).toBeNull();
  });

  describe('import into my plan', () => {
    const loadedPlan = (picks: Record<string, string> = {}) => {
      authState.user = { id: 'u1' };
      Object.assign(festivalState, {
        currentFestivalId: 'fest-1',
        currentProfile: { id: 'p1', festivalId: 'fest-1', picks },
        sets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      });
    };
    const threePicks = () =>
      snapshotHash([
        { setId: 'a', priority: 'must' },
        { setId: 'b', priority: 'want' },
        { setId: 'c', priority: 'must' },
      ]);

    it('sends a signed-out visitor to sign in and back to the same /p link', async () => {
      apiGet.mockResolvedValue(festival);
      const hash = snapshotHash([{ setId: 'set-1', priority: 'must' }]);
      setHash(hash);
      render(<PlanSnapshotPage />);
      const back = encodeURIComponent('/p');
      expect(screen.getByText('Sign in to add these picks to your plan.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?next=${back}`);
      expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', `/register?next=${back}`);
      expect(bulkSavePicks).not.toHaveBeenCalled();
      // The picks never go into the return path, which is a query string the server and its logs see.
      expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).not.toContain(hash);
      // Stashed when the page opens, so it survives the page re-mounting while the router leaves it.
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBe(hash);
      await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBe(hash);
    });

    it('keeps the stash when the page re-mounts before sign-in finishes', () => {
      apiGet.mockResolvedValue(festival);
      const hash = snapshotHash([{ setId: 'set-1', priority: 'must' }]);
      setHash(hash);
      render(<PlanSnapshotPage />).unmount();
      render(<PlanSnapshotPage />);
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBe(hash);
    });

    it('restores the stashed snapshot on the way back from sign-in', async () => {
      apiGet.mockResolvedValue(festival);
      const picks = Array.from({ length: 20 }, (_, i) => ({ setId: `set-${i}-${'x'.repeat(30)}`, priority: 'want' as const }));
      const hash = snapshotHash(picks);
      expect(hash.length).toBeGreaterThan(512);
      setHash(hash);
      const first = render(<PlanSnapshotPage />);
      const signIn = screen.getByRole('link', { name: 'Sign in' });
      expect(signIn).toHaveAttribute('href', `/login?next=${encodeURIComponent('/p')}`);
      await userEvent.click(signIn);
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBe(hash);
      first.unmount();

      setHash('');
      render(<PlanSnapshotPage />);
      expect(screen.getByRole('heading', { name: 'Snap Fest' })).toBeInTheDocument();
      expect(screen.getByText(/20 sets$/)).toBeInTheDocument();
      // Still signed out: the stash stays until sign-in finishes.
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBe(hash);
    });

    it('keeps the stash when the page re-mounts at /login with no hash and nobody signed in', () => {
      apiGet.mockResolvedValue(festival);
      const hash = snapshotHash([{ setId: 'set-1', priority: 'must' }]);
      setHash(hash);
      render(<PlanSnapshotPage />).unmount();
      setHash('');
      render(<PlanSnapshotPage />);
      expect(screen.getByRole('heading', { name: 'Snap Fest' })).toBeInTheDocument();
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBe(hash);
    });

    it('drops the stash once the viewer is signed in', () => {
      apiGet.mockResolvedValue(festival);
      sessionStorage.setItem('fk.pendingPlanSnapshot', snapshotHash([{ setId: 'set-1', priority: 'must' }]));
      authState.user = { id: 'u1' };
      setHash('');
      render(<PlanSnapshotPage />);
      expect(sessionStorage.getItem('fk.pendingPlanSnapshot')).toBeNull();
    });

    it('adds the new picks once, by priority, and offers undo', async () => {
      apiGet.mockResolvedValue(festival);
      loadedPlan({ b: 'must' });
      setHash(threePicks());
      render(<PlanSnapshotPage />);
      expect(bulkSavePicks).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Add 2 to my plan' }));
      await waitFor(() => expect(bulkSavePicks).toHaveBeenCalledWith(['a', 'c'], 'must'));
      expect(bulkSavePicks).toHaveBeenCalledTimes(1);
      expect(toastUndo).toHaveBeenCalledWith('Added 2 picks to your plan.', expect.any(Function));
      toastUndo.mock.calls[0]![1]();
      await waitFor(() => expect(restorePicks).toHaveBeenCalledWith({ a: undefined, c: undefined }));
    });

    it('says so when the viewer already has every pick', async () => {
      apiGet.mockResolvedValue(festival);
      loadedPlan({ a: 'must', b: 'must', c: 'must' });
      setHash(threePicks());
      render(<PlanSnapshotPage />);
      expect(screen.getByText('You already have all of these picks.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
    });

    it('shows a loading state, not "already have all", while the festival is still loading', async () => {
      apiGet.mockResolvedValue(festival);
      // selectFestival has set the id; the old festival's profile and sets are still in the store.
      authState.user = { id: 'u1' };
      Object.assign(festivalState, {
        currentFestivalId: 'fest-1',
        currentProfile: { id: 'p0', festivalId: 'other', picks: {} },
        sets: [{ id: 'z' }],
        isLoading: true,
      });
      setHash(threePicks());
      const first = render(<PlanSnapshotPage />);
      expect(screen.getByRole('status')).toHaveTextContent('Loading your plan');
      expect(screen.queryByText('You already have all of these picks.')).toBeNull();
      first.unmount();

      festivalState.isLoading = false;
      festivalState.error = 'offline';
      render(<PlanSnapshotPage />);
      expect(screen.getByText(/Couldn't load your plan/)).toBeInTheDocument();
      expect(screen.queryByText('You already have all of these picks.')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(selectFestival).toHaveBeenCalledWith('fest-1');
    });

    it('offers to switch when another festival is open, then to join when there is no profile', async () => {
      apiGet.mockResolvedValue(festival);
      loadedPlan();
      festivalState.currentFestivalId = 'other';
      setHash(threePicks());
      const first = render(<PlanSnapshotPage />);
      await userEvent.click(screen.getByRole('button', { name: 'Switch to Snap Fest' }));
      expect(selectFestival).toHaveBeenCalledWith('fest-1');
      first.unmount();

      festivalState.currentFestivalId = 'fest-1';
      festivalState.currentProfile = null;
      render(<PlanSnapshotPage />);
      expect(screen.getByText(/You haven't joined Snap Fest yet/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open Snap Fest' })).toHaveAttribute('href', '/cards');
    });
  });
});
