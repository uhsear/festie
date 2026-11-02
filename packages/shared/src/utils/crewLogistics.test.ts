import { describe, it, expect } from 'vitest';
import {
  memberDisplayName,
  packingClaim,
  packingClaimLine,
  rideDayOptions,
  rideDepartIso,
  rideDirectionLabel,
  ridePassengersLine,
  rideSeatAction,
  rideSeatsLeft,
  rideSeatsLine,
  rideTimeLabel,
  rideTimeParts,
} from './crewLogistics';
import type { CrewMember, FestivalDay } from '../types';

const members: CrewMember[] = [
  { userId: 'a', name: 'Alex' },
  { userId: 's', username: 'sam' },
];

describe('packing claims', () => {
  it('names a member, a username or a former member', () => {
    expect(memberDisplayName(members, 'a')).toBe('Alex');
    expect(memberDisplayName(members, 's')).toBe('sam');
    expect(memberDisplayName(members, 'x')).toBe('A former member');
    expect(memberDisplayName(members, null)).toBe('A former member');
  });

  it('covers open, mine and theirs, and lets only the owner release', () => {
    expect(packingClaim({ claimed: false, brought_by: null }, 'a', false)).toEqual({ state: 'open' });
    expect(packingClaim({ claimed: true, brought_by: null }, 'a', false)).toEqual({ state: 'open' });
    expect(packingClaim({ claimed: true, brought_by: 'a', packed: true }, 'a', false)).toEqual({
      state: 'mine',
      packed: true,
    });
    expect(packingClaim({ claimed: true, brought_by: 's' }, 'a', false)).toEqual({
      state: 'theirs',
      userId: 's',
      packed: false,
      canRelease: false,
    });
    expect(packingClaim({ claimed: true, brought_by: 's' }, 'a', true)).toMatchObject({ canRelease: true });
  });

  it('writes the claim line', () => {
    expect(packingClaimLine({ claimed: false, brought_by: null }, members, 'a')).toBeNull();
    expect(packingClaimLine({ claimed: true, brought_by: 'a' }, members, 'a')).toBe("You're bringing it");
    expect(packingClaimLine({ claimed: true, brought_by: 's', packed: true }, members, 'a')).toBe(
      'sam is bringing it · packed',
    );
  });
});

describe('ride seats', () => {
  const ride = { created_by: 'a', seats: 2, passenger_ids: ['s'] };

  it('counts seats left, full and null', () => {
    expect(rideSeatsLeft(ride)).toBe(1);
    expect(rideSeatsLeft({ seats: 1, passenger_ids: ['s', 'z'] })).toBe(0);
    expect(rideSeatsLeft({ seats: null, passenger_ids: [] })).toBeNull();
    expect(rideSeatsLine(ride)).toBe('1 of 2 seats left');
    expect(rideSeatsLine({ seats: 1, passenger_ids: ['s'] })).toBe('Full');
    expect(rideSeatsLine({ seats: null })).toBeNull();
  });

  it('picks the seat action', () => {
    expect(rideSeatAction(ride, 'a')).toBe('none');
    expect(rideSeatAction(ride, 's')).toBe('leave');
    expect(rideSeatAction({ ...ride, seats: 1 }, 'z')).toBe('full');
    expect(rideSeatAction(ride, 'z')).toBe('take');
    expect(rideSeatAction({ created_by: 'a', seats: null }, 'z')).toBe('take');
  });

  it('lists passengers and the direction', () => {
    expect(ridePassengersLine({ passenger_ids: ['a', 's'] }, members, 'a')).toBe('Riding: You, sam');
    expect(ridePassengersLine({ passenger_ids: [] }, members, 'a')).toBeNull();
    expect(rideDirectionLabel('to_festival')).toBe('To the festival');
    expect(rideDirectionLabel('home')).toBe('Heading home');
    expect(rideDirectionLabel(null)).toBeNull();
  });
});

describe('ride time', () => {
  it('reads wall time in the festival zone, across the DST start', () => {
    expect(rideDepartIso('2026-03-29', '14:00', 'Europe/Amsterdam')).toBe('2026-03-29T12:00:00.000Z');
    expect(rideDepartIso('2026-03-29', '25:00', 'Europe/Amsterdam')).toBeNull();
    expect(rideDepartIso('2026-03-29', 'noon', 'Europe/Amsterdam')).toBeNull();
    expect(rideDepartIso('bad', '14:00')).toBeNull();
  });

  it('round-trips through rideTimeParts', () => {
    const iso = rideDepartIso('2026-03-29', '14:00', 'Europe/Amsterdam')!;
    expect(rideTimeParts(iso, 'Europe/Amsterdam')).toEqual({ date: '2026-03-29', time: '14:00' });
    const local = rideDepartIso('2026-07-04', '09:30')!;
    expect(rideTimeParts(local)).toEqual({ date: '2026-07-04', time: '09:30' });
    expect(rideTimeParts('nope')).toBeNull();
  });

  it('labels the time in the zone and falls back to depart_at', () => {
    expect(rideTimeLabel({ depart_time: '2026-03-27T18:00:00.000Z', depart_at: 'old' }, 'America/New_York')).toBe(
      'Fri 2:00 PM',
    );
    expect(rideTimeLabel({ depart_time: null, depart_at: 'around noon' })).toBe('around noon');
    expect(rideTimeLabel({ depart_time: null, depart_at: null })).toBeNull();
  });

  it('offers festival days with a label or weekday', () => {
    const days = [{ date: '2026-03-27', label: 'Day 1' }, { date: '2026-03-28' }] as FestivalDay[];
    expect(rideDayOptions(days)).toEqual([
      { date: '2026-03-27', label: 'Day 1' },
      { date: '2026-03-28', label: 'Sat' },
    ]);
  });
});
