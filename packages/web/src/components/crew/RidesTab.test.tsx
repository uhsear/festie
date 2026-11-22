import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RidesTab from './RidesTab';

const { state } = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('@festie/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared')>()),
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));
vi.mock('@festie/shared/stores', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/stores')>()),
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      currentFestival: { id: 'fest-1', timeZone: 'America/New_York' },
      days: [{ id: 'd1', date: '2026-07-04' }],
    }),
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn(), toastUndo: vi.fn() }),
}));
vi.mock('../../hooks/useHaptics', () => ({ useHaptics: () => ({ select: vi.fn(), warning: vi.fn() }) }));

const members = [
  { userId: 'me', username: 'me', name: 'Me' },
  { userId: 'sam', username: 'sam', name: 'Sam' },
];

const offer = (over: Record<string, unknown>) => ({
  id: 'r1',
  crew_id: 'crew-1',
  created_by: 'sam',
  driver: 'Sam',
  seats: 3,
  depart_from: null,
  depart_at: null,
  note: null,
  direction: 'to_festival',
  depart_time: '2026-07-04T18:00:00.000Z',
  passenger_ids: [],
  ...over,
});

const offlineError = () =>
  Object.assign(new Error('Failed to fetch'), { name: 'ApiClientError', status: 0, isNetworkError: true });
const serverError = () => Object.assign(new Error('upstream exploded'), { name: 'ApiClientError', status: 503 });
const OFFLINE_COPY = "You're offline. Check your connection and try again.";
const SERVER_COPY = 'Something went wrong on our side. Try again in a minute.';

function setup(
  offers: unknown[],
  isOwner = false,
  festivalId = 'fest-1',
  loadRides: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  Object.assign(state, {
    rideOffers: offers,
    loadRides,
    createRideOffer: vi.fn(),
    updateRideOffer: vi.fn(),
    deleteRideOffer: vi.fn(),
    takeRideSeat: vi.fn(),
    leaveRideSeat: vi.fn(),
    crewMembers: members,
    activeCrew: { id: 'crew-1', festivalId, members },
  });
  return render(<RidesTab crewId="crew-1" currentUserId="me" isOwner={isOwner} />);
}

describe('RidesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows one loading status, not the empty state, while rides load', () => {
    setup([], false, 'fest-1', () => new Promise(() => {}));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
    expect(screen.queryByText('No rides yet')).toBeNull();
  });

  it('shows the offline copy and a Retry, not "No rides yet", when the load fails offline', async () => {
    const loadRides = vi.fn().mockRejectedValueOnce(offlineError()).mockResolvedValue(undefined);
    setup([], false, 'fest-1', loadRides);
    expect(await screen.findByText("Couldn't load rides")).toBeTruthy();
    expect(screen.getByText(OFFLINE_COPY)).toBeTruthy();
    expect(screen.queryByText('No rides yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No rides yet')).toBeTruthy();
    expect(loadRides).toHaveBeenCalledTimes(2);
  });

  it('shows the server copy when the load fails with a 5xx', async () => {
    setup([], false, 'fest-1', vi.fn().mockRejectedValue(serverError()));
    expect(await screen.findByText(SERVER_COPY)).toBeTruthy();
    expect(screen.queryByText(/upstream exploded/)).toBeNull();
  });

  it('keeps rides already in the store visible when the refresh fails', async () => {
    setup([offer({})], false, 'fest-1', vi.fn().mockRejectedValue(offlineError()));
    expect(await screen.findByRole('button', { name: 'Take a seat' })).toBeTruthy();
    expect(screen.queryByText("Couldn't load rides")).toBeNull();
    expect(await screen.findByText(/Couldn't refresh/)).toBeTruthy();
  });

  it('retries a failed refresh through the stale note', async () => {
    const loadRides = vi.fn().mockRejectedValueOnce(offlineError()).mockResolvedValue(undefined);
    setup([offer({})], false, 'fest-1', loadRides);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh/)).toBeNull());
    expect(loadRides).toHaveBeenCalledTimes(2);
  });

  it('ignores a Retry that settles after the crew changed', async () => {
    let rejectRetry: (e: unknown) => void = () => {};
    const loadRides = vi
      .fn()
      .mockRejectedValueOnce(offlineError())
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectRetry = reject)))
      .mockResolvedValue(undefined);
    const view = setup([], false, 'fest-1', loadRides);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    view.rerender(<RidesTab crewId="crew-2" currentUserId="me" isOwner={false} />);
    rejectRetry(serverError());
    expect(await screen.findByText('No rides yet')).toBeTruthy();
    expect(screen.queryByText("Couldn't load rides")).toBeNull();
  });

  it('an empty list offers a ride and does not promise a way to ask for one', async () => {
    setup([]);
    expect(await screen.findByText('Offer a ride so the crew can take a seat.')).toBeTruthy();
    expect(screen.queryByText(/ask for one/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Offer a ride' }));
    expect(await screen.findByText('New ride')).toBeTruthy();
  });

  it('open ride offers Take a seat and shows seats, direction and time in festival time', async () => {
    setup([offer({})]);
    expect(await screen.findByRole('button', { name: 'Take a seat' })).toBeTruthy();
    expect(screen.getByText('3 of 3 seats left')).toBeTruthy();
    expect(screen.getByText('To the festival')).toBeTruthy();
    expect(screen.getByText('Sat 2:00 PM')).toBeTruthy();
  });

  it('passenger sees Leave ride and the riders', async () => {
    setup([offer({ passenger_ids: ['me'] })]);
    expect(await screen.findByRole('button', { name: 'Leave ride' })).toBeTruthy();
    expect(screen.getByText('Riding: You')).toBeTruthy();
  });

  it('full ride shows a disabled Full button', async () => {
    setup([offer({ seats: 1, passenger_ids: ['sam2'] })]);
    const full = (await screen.findByRole('button', { name: 'Full' })) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
  });

  it('poster gets no seat button but can edit', async () => {
    setup([offer({ created_by: 'me' })]);
    expect(await screen.findByRole('button', { name: 'Edit ride' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take a seat' })).toBeNull();
  });

  it('edit shows only for the poster or the owner', async () => {
    const { unmount } = setup([offer({})]);
    await screen.findByRole('button', { name: 'Take a seat' });
    expect(screen.queryByRole('button', { name: 'Edit ride' })).toBeNull();
    unmount();
    setup([offer({})], true);
    expect(await screen.findByRole('button', { name: 'Edit ride' })).toBeTruthy();
  });
  it('saving an edit leaves out time fields the form did not set', async () => {
    setup([offer({ created_by: 'me', depart_at: 'after lunch' })], false, 'other-fest');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit ride' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save ride' }));
    const update = state.updateRideOffer as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledTimes(1);
    const request = update.mock.calls[0]![2];
    expect(request).not.toHaveProperty('departTime');
    expect(request.departAt).toBe('after lunch');
  });

  it('saving an edit with a festival frame keeps the legacy free-text time', async () => {
    setup([offer({ created_by: 'me', depart_at: 'after lunch', depart_time: null })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit ride' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save ride' }));
    const request = (state.updateRideOffer as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(request).not.toHaveProperty('departAt');
    expect(request).not.toHaveProperty('departTime');
  });
});
