import { describe, it, expect } from 'vitest';
import {
  parseInviteCode,
  describeInvitePreview,
  inviteShareMessage,
  formatInviteExpiry,
  inviteErrorStatus,
  inviteStatusMessage,
  type InviteStatus,
} from './invite';
import type { InvitePreview } from '../types/api';

const preview: InvitePreview = {
  crewName: 'Tent 9',
  ownerName: 'asir',
  memberCount: 6,
  maxMembers: 30,
  spotsLeft: 24,
  festivalId: 'f1',
  festivalName: 'EDC Orlando',
  startDate: '2026-11-06',
  endDate: '2026-11-08',
  expiresAt: null,
};

describe('parseInviteCode', () => {
  it.each([
    ['k7xq2m', 'K7XQ2M'],
    [' https://festie.us/join/k7xq2m ', 'K7XQ2M'],
    ['festie.us/join/K7XQ2M', 'K7XQ2M'],
    ['https://festie.us/?joinCrew=k7xq2m', 'K7XQ2M'],
    ['festie://join/k7xq2m', 'K7XQ2M'],
    ['https://festie.us/join/k7xq2m?ref=abc', 'K7XQ2M'],
  ])('parses %s', (input, expected) => {
    expect(parseInviteCode(input)).toBe(expected);
  });

  it.each(['hello world', '', 'abc', 'https://festie.us/set/abc123', 'toolongcode12345'])('rejects %j', (input) => {
    expect(parseInviteCode(input)).toBeNull();
  });
});

describe('describeInvitePreview', () => {
  it('describes a full preview', () => {
    expect(describeInvitePreview(preview)).toEqual({
      title: 'Tent 9',
      stateLine: 'Crew of 6 · 24 spots left',
      festivalLine: 'EDC Orlando · Nov 6 – Nov 8, 2026',
      ownerLine: 'Started by asir',
    });
  });

  it('uses singular for one spot and "full" for none', () => {
    expect(describeInvitePreview({ ...preview, spotsLeft: 1 }).stateLine).toBe('Crew of 6 · 1 spot left');
    expect(describeInvitePreview({ ...preview, spotsLeft: 0 }).stateLine).toBe('Crew of 6 · full');
  });

  it('leaves out missing festival and owner', () => {
    const d = describeInvitePreview({
      ...preview,
      festivalName: null,
      startDate: null,
      endDate: null,
      ownerName: null,
    });
    expect(d.festivalLine).toBeNull();
    expect(d.ownerLine).toBeNull();
  });

  it('keeps the festival name when dates are missing', () => {
    expect(describeInvitePreview({ ...preview, startDate: null, endDate: null }).festivalLine).toBe('EDC Orlando');
  });
});

describe('inviteShareMessage', () => {
  it('works with and without a url', () => {
    expect(inviteShareMessage('Tent 9')).toBe('Join "Tent 9" on Festie');
    expect(inviteShareMessage('Tent 9', 'https://festie.us/join/ABC123')).toBe(
      'Join "Tent 9" on Festie: https://festie.us/join/ABC123',
    );
  });
});

describe('formatInviteExpiry', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  it('handles empty and invalid input', () => {
    expect(formatInviteExpiry(null, now)).toBeNull();
    expect(formatInviteExpiry(undefined, now)).toBeNull();
    expect(formatInviteExpiry('nope', now)).toBeNull();
  });
  it('formats past, minutes, hours and days', () => {
    expect(formatInviteExpiry('2026-10-31T00:00:00Z', now)).toBe('Expired');
    expect(formatInviteExpiry(new Date(now + 30_000).toISOString(), now)).toBe('Expires in 1m');
    expect(formatInviteExpiry(new Date(now + 10 * 60_000).toISOString(), now)).toBe('Expires in 10m');
    expect(formatInviteExpiry(new Date(now + 5 * 3_600_000).toISOString(), now)).toBe('Expires in 5h');
    expect(formatInviteExpiry(new Date(now + 3 * 86_400_000).toISOString(), now)).toBe('Expires in 3d');
  });
});

describe('inviteErrorStatus', () => {
  it('maps statuses', () => {
    expect(inviteErrorStatus({ status: 404 })).toBe('invalid');
    expect(inviteErrorStatus({ status: 410 })).toBe('expired');
    expect(inviteErrorStatus({ status: 500 })).toBe('unreachable');
    expect(inviteErrorStatus({ status: 429 })).toBe('unreachable');
    expect(inviteErrorStatus(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(inviteErrorStatus(null)).toBe('unreachable');
  });
});

describe('inviteStatusMessage', () => {
  it('has copy for each status', () => {
    const statuses: InviteStatus[] = ['loading', 'ready', 'invalid', 'expired', 'unreachable'];
    const signedIn = statuses.map((s) => inviteStatusMessage(s, true));
    expect(signedIn[0]).toBeNull();
    expect(signedIn[1]).toBeNull();
    expect(signedIn[2]).toMatch(/couldn't find a crew/);
    expect(signedIn[3]).toMatch(/has expired/);
    expect(signedIn[4]).toMatch(/You can still join/);
  });
  it('asks guests to sign in when unreachable', () => {
    expect(inviteStatusMessage('unreachable', false)).toMatch(/Sign in or create an account/);
    expect(inviteStatusMessage('invalid', false)).toBe(inviteStatusMessage('invalid', true));
  });
});
