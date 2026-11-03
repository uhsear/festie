import { describe, it, expect } from 'vitest';
import {
  ANNOUNCEMENT_SCREENS,
  announcementStatus,
  announcementTarget,
  announcementWebPath,
  pickBannerAnnouncement,
} from './announcements';
import { resolvePushTarget } from './pushTarget';
import type { AdminAnnouncement, AnnouncementScreen, FestivalAnnouncement } from '../types/announcement';

const PATHS: Record<AnnouncementScreen, string> = {
  home: '/',
  map: '/map',
  timeline: '/timeline',
  picks: '/picks',
  'festival-mode': '/festival-mode',
  crew: '/crew',
};

// Deep links as lib/announcements.ts builds them.
function deepLink(screen: AnnouncementScreen, festivalId: string): string {
  const origin = 'https://festie.us';
  return screen === 'home' ? `${origin}/?festival=${encodeURIComponent(festivalId)}` : `${origin}/${screen}`;
}

const fa = (id: string, severity: 'info' | 'urgent' = 'info'): FestivalAnnouncement => ({
  id,
  festivalId: 'f1',
  severity,
  title: 't',
  body: 'b',
  screen: 'home',
  sentAt: '2026-11-01T10:00:00Z',
});

const admin = (over: Partial<AdminAnnouncement>): AdminAnnouncement => ({
  ...fa('a'),
  sendAt: '2026-11-01T10:00:00Z',
  sentAt: null,
  cancelledAt: null,
  recipientCount: null,
  createdBy: null,
  createdAt: '2026-11-01T09:00:00Z',
  ...over,
});

describe('announcement screens', () => {
  it.each(ANNOUNCEMENT_SCREENS)('maps %s to a web path and a target', (screen) => {
    expect(announcementWebPath(screen)).toBe(PATHS[screen]);
    const target = announcementTarget({ screen, festivalId: 'f1' });
    expect(resolvePushTarget({ festivalId: 'f1', deepLink: deepLink(screen, 'f1') })).toEqual(target);
  });

  it('uses the expected target kinds', () => {
    expect(announcementTarget({ screen: 'home', festivalId: 'f1' })).toEqual({ kind: 'festival', festivalId: 'f1' });
    expect(announcementTarget({ screen: 'crew', festivalId: 'f1' })).toEqual({ kind: 'crew' });
    expect(announcementTarget({ screen: 'map', festivalId: 'f1' })).toEqual({ kind: 'screen', screen: 'map' });
  });
});

describe('pickBannerAnnouncement', () => {
  it('prefers urgent over a newer info', () => {
    expect(pickBannerAnnouncement([fa('new'), fa('old', 'urgent')], [])?.id).toBe('old');
  });
  it('falls back to the newest non-dismissed', () => {
    expect(pickBannerAnnouncement([fa('new'), fa('old')], ['new'])?.id).toBe('old');
  });
  it('skips dismissed urgent', () => {
    expect(pickBannerAnnouncement([fa('new'), fa('old', 'urgent')], ['old'])?.id).toBe('new');
  });
  it('returns null when all are dismissed or empty', () => {
    expect(pickBannerAnnouncement([fa('a')], ['a'])).toBeNull();
    expect(pickBannerAnnouncement([], [])).toBeNull();
  });
});

describe('announcementStatus', () => {
  it('scheduled', () => expect(announcementStatus(admin({}))).toBe('scheduled'));
  it('sent', () => expect(announcementStatus(admin({ sentAt: '2026-11-01T10:00:05Z' }))).toBe('sent'));
  it('cancelled', () => {
    expect(announcementStatus(admin({ cancelledAt: '2026-11-01T09:30:00Z' }))).toBe('cancelled');
    expect(
      announcementStatus(admin({ sentAt: '2026-11-01T10:00:05Z', cancelledAt: '2026-11-01T12:00:00Z' })),
    ).toBe('cancelled');
  });
  it('expired when cancelled unsent more than 30 minutes after send time', () => {
    expect(announcementStatus(admin({ cancelledAt: '2026-11-01T10:31:00Z' }))).toBe('expired');
    expect(announcementStatus(admin({ cancelledAt: '2026-11-01T10:29:00Z' }))).toBe('cancelled');
  });
});
