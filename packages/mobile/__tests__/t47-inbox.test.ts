import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t47 mobile inbox wiring', () => {
  it('the inbox screen marks seen, clears the app badge and routes taps', () => {
    const src = read('app/inbox.tsx');
    expect(src).toContain('markAllSeen');
    expect(src).toContain('setBadgeCountAsync(0)');
    expect(src).toContain('routeNotification(');
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
