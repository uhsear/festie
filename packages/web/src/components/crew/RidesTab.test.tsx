import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

function setup(offers: unknown[], isOwner = false, festivalId = 'fest-1') {
  Object.assign(state, {
    rideOffers: offers,
    loadRides: vi.fn().mockResolvedValue(undefined),
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
    const request = update.mock.calls[0][2];
    expect(request).not.toHaveProperty('departTime');
    expect(request.departAt).toBe('after lunch');
  });

  it('saving an edit with a festival frame keeps the legacy free-text time', async () => {
    setup([offer({ created_by: 'me', depart_at: 'after lunch', depart_time: null })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit ride' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save ride' }));
    const request = (state.updateRideOffer as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(request).not.toHaveProperty('departAt');
    expect(request).not.toHaveProperty('departTime');
  });
});
