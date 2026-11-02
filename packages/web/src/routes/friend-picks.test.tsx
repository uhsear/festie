import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const search = { from: 'tok123' as string | undefined };
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => search,
}));

const fetchSharedPicks = vi.fn();
vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchSharedPicks: (...a: unknown[]) => fetchSharedPicks(...a),
}));

const bulkSavePicks = vi.fn();
const restorePicks = vi.fn();
const storeState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', async (orig) => {
  const useFestivalStore = Object.assign((sel: (s: unknown) => unknown) => sel(storeState), {
    getState: () => storeState,
  });
  const useAuthStore = (sel: (s: unknown) => unknown) => sel({ user: authUser.value });
  return { ...(await orig<Record<string, unknown>>()), useFestivalStore, useAuthStore };
});
const authUser: { value: unknown } = { value: { id: 'u1' } };

const toast = vi.fn();
const toastUndo = vi.fn();
const toastError = vi.fn();
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast, toastUndo, toastError }) }));

import { ApiClientError } from '@festie/shared/services';
import FriendPicksView from './friend-picks';

const payload = {
  username: 'alice',
  festivalName: 'EDC',
  festivalId: 'f1',
  picks: { s1: 'must', s2: 'want-to-see', s3: 'maybe' },
  festival: {
    stages: [{ id: 'st', name: 'Main', color: '#ff0000' }],
    days: [
      {
        label: 'Sat',
        date: '2026-09-05',
        sets: [
          { id: 's1', artist: 'One', stageId: 'st', dayIndex: 0, startTime: '20:00', endTime: '21:00' },
          { id: 's2', artist: 'Two', stageId: 'st', dayIndex: 0, startTime: '21:00', endTime: '22:00' },
          { id: 's3', artist: 'Three', stageId: 'st', dayIndex: 0, startTime: '22:00', endTime: '23:00' },
        ],
      },
    ],
    b2bSeparator: null,
  },
};

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FriendPicksView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  search.from = 'tok123';
  authUser.value = { id: 'u1' };
  Object.assign(storeState, {
    currentFestivalId: 'f1',
    currentProfile: { picks: { s2: 'must' } },
    bulkSavePicks,
    restorePicks,
    selectFestival: vi.fn(),
  });
  bulkSavePicks.mockResolvedValue(1);
  restorePicks.mockResolvedValue(undefined);
  fetchSharedPicks.mockResolvedValue(payload);
});

describe('FriendPicksView', () => {
  it('renders comparison counts', async () => {
    renderView();
    expect(await screen.findByText('1 in common · 2 only alice · 0 only you')).toBeTruthy();
  });

  it('shows no checkboxes for a guest', async () => {
    authUser.value = null;
    renderView();
    await screen.findByText('Sign in to compare these picks with yours.');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('adds ticked sets once per priority and undo restores previous picks', async () => {
    renderView();
    const addBtn = await screen.findByRole('button', { name: 'Add 1 to my plan' });
    fireEvent.click(screen.getByLabelText(/Three/));
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2 to my plan' }));
    await waitFor(() => expect(bulkSavePicks).toHaveBeenCalledTimes(2));
    expect(bulkSavePicks).toHaveBeenCalledWith(['s1'], 'must');
    expect(bulkSavePicks).toHaveBeenCalledWith(['s3'], 'maybe');
    expect(addBtn).toBeTruthy();
    await waitFor(() => expect(toastUndo).toHaveBeenCalled());
    expect(toastUndo.mock.calls[0][0]).toBe('Added 2 picks to your plan.');
    toastUndo.mock.calls[0][1]();
    await waitFor(() => expect(restorePicks).toHaveBeenCalledWith({ s1: undefined, s3: undefined }));
  });

  it('shows the 404 text', async () => {
    fetchSharedPicks.mockRejectedValue(new ApiClientError('nope', 404, 'NOT_FOUND'));
    renderView();
    expect(await screen.findByText('This link no longer works. Ask your friend for a new one.')).toBeTruthy();
  });

  it('offers Switch, not Open, when no festival is selected', async () => {
    Object.assign(storeState, { currentFestivalId: null, currentProfile: null });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to EDC' }));
    expect(storeState.selectFestival).toHaveBeenCalledWith('f1');
    expect(screen.queryByText(/haven't joined/)).toBeNull();
  });

  it('shows the not-joined banner when the festival matches but there is no profile', async () => {
    Object.assign(storeState, { currentProfile: null });
    renderView();
    expect(await screen.findByText("You haven't joined EDC yet. Join it to compare and add picks.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open EDC' })).toBeTruthy();
  });

  it('shows the bad-link text without fetching', () => {
    search.from = '../x';
    renderView();
    expect(screen.getByText("This link can't be read. Ask your friend to send it again.")).toBeTruthy();
    expect(fetchSharedPicks).not.toHaveBeenCalled();
  });
});
