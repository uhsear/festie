// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Public crew-invite preview, shared by GET /crews/join-preview/:inviteCode and
// the server-rendered /join/:code page so both describe an invite the same way.

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
  | { status: 'ok'; preview: InvitePreview }
  | { status: 'expired' }
  | { status: 'invalid' };

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

  const [members, festival] = await Promise.all([
    stores.crews.getMembers(crew.id),
    crew.festivalId ? getFestivalById(crew.festivalId) : null,
  ]);
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
    preview: {
      crewName: crew.name,
      ownerName: owner?.name || owner?.username || null,
      memberCount: members.length,
      maxMembers,
      spotsLeft: Math.max(0, maxMembers - members.length),
      festivalId: crew.festivalId || null,
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
