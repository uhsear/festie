import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('t47 mobile inbox wiring', () => {
  it('the inbox screen marks seen, clears the app badge and routes taps', () => {
    const src = read('app/inbox.tsx');
    expect(src).toContain('markAllSeen');
    expect(src).toContain('setBadgeCountAsync(0)');
    expect(src).toContain('routeNotification(');
  });

  it('each row names its festival and uses the shared label', () => {
    const src = read('app/inbox.tsx');
    expect(src).toContain('inboxRowLabel(item, ago, unread)');
    expect(src).toContain('item.festivalName');
  });

  it('the artist line carries the same "Artist:" prefix as web', () => {
    expect(read('app/inbox.tsx')).toContain('Artist:');
    expect(read('../web/src/routes/inbox.tsx')).toContain('Artist:');
  });

  it('_layout imports routeNotification instead of defining it', () => {
    const src = read('app/_layout.tsx');
    expect(src).toContain("from '../lib/routeNotification'");
    expect(src).not.toMatch(/function routeNotification/);
  });

  it('ScreenHeader renders the bell', () => {
    expect(read('components/ScreenHeader.tsx')).toContain('<InboxBell');
  });

  it('the bell opens /inbox and uses the shared count label', () => {
    const src = read('components/InboxBell.tsx');
    expect(src).toContain("router.push('/inbox')");
    expect(src).toContain('inboxBadgeLabel');
  });
});
