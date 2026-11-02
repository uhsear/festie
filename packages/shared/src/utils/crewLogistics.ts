/**
 * Packing claims and ride seats: the copy and rules web and mobile share so a
 * claimed item and a taken seat read the same on both platforms.
 */
import type { CrewMember, CrewPackingItem, CrewRideOffer, FestivalDay } from '../types';
import { createDateInLocalFrame, zonedWallTimeToMs } from './setStatus';

type PackingClaimInput = Pick<CrewPackingItem, 'claimed' | 'brought_by' | 'packed'>;
type RideInput = Pick<CrewRideOffer, 'seats' | 'passenger_ids' | 'created_by'>;

/** A member's `name`, else `username`, else a stand-in for someone who left. */
export function memberDisplayName(members: CrewMember[], userId: string | null | undefined): string {
  const m = userId ? members.find((x) => x.userId === userId) : undefined;
  return m?.name || m?.username || 'A former member';
}

export type PackingClaim =
  | { state: 'open' }
  | { state: 'mine'; packed: boolean }
  | { state: 'theirs'; userId: string; packed: boolean; canRelease: boolean };

/** Who is bringing an item. Only the claimer or the crew owner can release a claim. */
export function packingClaim(item: PackingClaimInput, currentUserId: string, isOwner: boolean): PackingClaim {
  if (!item.claimed || !item.brought_by) return { state: 'open' };
  const packed = item.packed === true;
  if (item.brought_by === currentUserId) return { state: 'mine', packed };
  return { state: 'theirs', userId: item.brought_by, packed, canRelease: isOwner };
}

/** "You're bringing it" | "Sam is bringing it", with " · packed" when packed. Null when open. */
export function packingClaimLine(item: PackingClaimInput, members: CrewMember[], currentUserId: string): string | null {
  const claim = packingClaim(item, currentUserId, false);
  if (claim.state === 'open') return null;
  const base =
    claim.state === 'mine' ? "You're bringing it" : `${memberDisplayName(members, claim.userId)} is bringing it`;
  return claim.packed ? `${base} · packed` : base;
}

/** Open seats, floored at 0. Null when the ride has no seat count. */
export function rideSeatsLeft(offer: Pick<CrewRideOffer, 'seats' | 'passenger_ids'>): number | null {
  if (offer.seats == null) return null;
  return Math.max(0, offer.seats - (offer.passenger_ids?.length ?? 0));
}

export function rideSeatAction(offer: RideInput, currentUserId: string): 'none' | 'take' | 'leave' | 'full' {
  if (offer.created_by === currentUserId) return 'none';
  if (offer.passenger_ids?.includes(currentUserId)) return 'leave';
  return rideSeatsLeft(offer) === 0 ? 'full' : 'take';
}

export function rideSeatsLine(offer: Pick<CrewRideOffer, 'seats' | 'passenger_ids'>): string | null {
  const left = rideSeatsLeft(offer);
  if (left === null) return null;
  return left === 0 ? 'Full' : `${left} of ${offer.seats} seats left`;
}

/** "Riding: You, Sam, Alex". Null when nobody has a seat. */
export function ridePassengersLine(
  offer: Pick<CrewRideOffer, 'passenger_ids'>,
  members: CrewMember[],
  currentUserId: string,
): string | null {
  const ids = offer.passenger_ids ?? [];
  if (ids.length === 0) return null;
  const names = ids.map((id) => (id === currentUserId ? 'You' : memberDisplayName(members, id)));
  return `Riding: ${names.join(', ')}`;
}

export function rideDirectionLabel(direction: 'to_festival' | 'home' | null | undefined): string | null {
  if (direction === 'to_festival') return 'To the festival';
  if (direction === 'home') return 'Heading home';
  return null;
}

/** Festival days as picker options. The weekday of a calendar date does not depend on the zone. */
export function rideDayOptions(days: FestivalDay[], _timeZone?: string): { date: string; label: string }[] {
  return days.map((d) => {
    const [y, m, day] = d.date.slice(0, 10).split('-').map(Number);
    const weekday = new Date(Date.UTC(y!, m! - 1, day!)).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC',
    });
    return { date: d.date.slice(0, 10), label: d.label || weekday };
  });
}

/** `YYYY-MM-DD` + `HH:MM` read in the festival's zone (else the device's) to an ISO instant. */
export function rideDepartIso(date: string, time: string, timeZone?: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const hours = Number(t[1]);
  const minutes = Number(t[2]);
  if (hours > 23 || minutes > 59) return null;
  const ms = timeZone
    ? zonedWallTimeToMs(date, hours, minutes, timeZone)
    : createDateInLocalFrame(date, hours, minutes).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Inverse of `rideDepartIso`, for filling the edit form. */
export function rideTimeParts(departTime: string, timeZone?: string): { date: string; time: string } | null {
  const ms = Date.parse(departTime);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** "Fri 2:00 PM" in the festival zone, else the legacy free-text `depart_at`, else null. */
export function rideTimeLabel(
  offer: Pick<CrewRideOffer, 'depart_time' | 'depart_at'>,
  timeZone?: string,
): string | null {
  const ms = offer.depart_time ? Date.parse(offer.depart_time) : NaN;
  if (Number.isFinite(ms)) {
    const zone = timeZone ? { timeZone } : {};
    const d = new Date(ms);
    const day = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'short' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { ...zone, hour: 'numeric', minute: '2-digit' })
      .format(d)
      .replace(/\u202f/g, ' ');
    return `${day} ${time}`;
  }
  return offer.depart_at || null;
}
