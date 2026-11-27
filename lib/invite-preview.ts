// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Public crew-invite preview, shared by GET /crews/join-preview/:inviteCode and
// the server-rendered /join/:code page so both describe an invite the same way.

import { FESTIVAL_STATUS_LABEL } from '../packages/shared/src/constants/copy';
import { festivalStatus, resolveFestivalTimeZone } from '../packages/shared/src/utils/festivalTime';

export interface InvitePreview {
  crewName: string;
  ownerName: string | null;
  memberCount: number;
  maxMembers: number;
  spotsLeft: number;
  festivalId: string | null;
  festivalName: string | null;
  startDate: string | null;
  endDate: string | null;
  expiresAt: string | null;
}

export type InvitePreviewResult =
  | { status: 'ok'; preview: InvitePreview; memberInitials: string[]; festivalTimeZone: string | null }
  | { status: 'expired' }
  | { status: 'invalid' }
  | { status: 'locked' };

const MAX_INITIALS = 5;

/** One upper-case letter per member for the invite page faces, in join order. No names leave this function. */
function initialsOf(members: any[]): string[] {
  return members
    .map((m) => Array.from(String(m.name || m.username || '').trim())[0]?.toUpperCase())
    .filter((initial): initial is string => Boolean(initial))
    .slice(0, MAX_INITIALS);
}

const INVITE_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export async function loadInvitePreview(
  { stores, getFestivalById }: { stores: any; getFestivalById: (id: string) => Promise<any> },
  rawCode: unknown,
): Promise<InvitePreviewResult> {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!INVITE_CODE_PATTERN.test(code)) return { status: 'invalid' };

  const crew = await stores.crews.getByInviteCode(code);
  if (!crew) {
    const expired = await stores.crews.getExpiredByInviteCode(code);
    return { status: expired ? 'expired' : 'invalid' };
  }
  // T54: a locked crew shows only its status, so no member read happens.
  if (crew.inviteLocked) return { status: 'locked' };

  const [members, festivalRow] = await Promise.all([
    stores.crews.getMembers(crew.id),
    crew.festivalId ? getFestivalById(crew.festivalId) : null,
  ]);
  // A draft festival is not public: the invite then shows no festival.
  const festival = festivalRow?.publishedAt ? festivalRow : null;
  const owner = members.find((m: any) => m.role === 'owner');
  // Same derivation as the festival list (routes/festivals.ts): the festivals
  // table has no start/end columns, so the range comes from the day dates.
  const dates = (festival?.days || [])
    .map((d: any) => d.date)
    .filter(Boolean)
    .sort();
  const maxMembers = crew.maxMembers || 30;

  return {
    status: 'ok',
    memberInitials: initialsOf(members),
    // Not part of the public preview contract: the invite page needs it to place "now" in the festival's day.
    festivalTimeZone: festival?.timeZone || null,
    preview: {
      crewName: crew.name,
      ownerName: owner?.name || owner?.username || null,
      memberCount: members.length,
      maxMembers,
      spotsLeft: Math.max(0, maxMembers - members.length),
      festivalId: festival ? crew.festivalId : null,
      festivalName: festival?.name || null,
      startDate: dates[0] || null,
      endDate: dates[dates.length - 1] || null,
      expiresAt: crew.inviteExpiresAt || null,
    },
  };
}

/**
 * "Nov 6 – Nov 8, 2026". Same rule as formatFestivalDateRange in
 * packages/shared/src/utils/format.ts, which the backend must not import. The
 * dates are calendar days, so they are formatted in UTC to stay on the same day.
 */
export function formatInviteDateRange(startDate: string | null, endDate: string | null): string | null {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

const MS_PER_DAY = 86_400_000;

/**
 * "Fri in 9 days", "Fri tomorrow", "Happening now" or "Ended"; null without dates. The phase
 * comes from the shared festivalStatus, so this page agrees with the festival pill in the app:
 * a festival is live from 00:00 on its first day in the festival's own zone. "Starts today" is
 * what remains when the festival has no zone and the server clock is a day behind its UTC date.
 */
export function inviteCountdown(
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date(),
  timeZone: string | null = null,
): string | null {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const festival = { startDate, endDate, timeZone: timeZone ?? undefined } as Parameters<typeof festivalStatus>[0];
  const phase = festivalStatus(festival, null, now);
  if (!phase) return null;
  if (phase === 'past') return 'Ended';
  if (phase === 'ongoing') return FESTIVAL_STATUS_LABEL.ongoing;
  const zone = resolveFestivalTimeZone({ timeZone });
  const today = Date.parse(`${now.toLocaleDateString('en-CA', { timeZone: zone ?? 'UTC' })}T00:00:00Z`);
  const days = Math.round((start.getTime() - today) / MS_PER_DAY);
  if (days <= 0) return 'Starts today';
  const weekday = start.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return days === 1 ? `${weekday} tomorrow` : `${weekday} in ${days} days`;
}
