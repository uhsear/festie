import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('t47 tab badges and inbox refresh', () => {
  it('tab layout renders the Crew badge and refreshes the inbox', () => {
    const src = read('app/(tabs)/_layout.tsx');
    expect(src).toContain('NativeTabs.Trigger.Badge');
    expect(src).toContain('crewTabBadge(');
    expect(src).toContain('useInboxRefresh(');
  });
  it('crew screen marks the badge seen', () => {
    expect(read('app/(tabs)/crew.tsx')).toContain('markCrewBadgeSeen');
  });
  it('useInboxRefresh covers push, resume and offline', () => {
    const src = read('hooks/useInboxRefresh.ts');
    expect(src).toContain('addNotificationReceivedListener');
    expect(src).toContain('AppState');
    expect(src).toContain('offlineMode');
  });
});
