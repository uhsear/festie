import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('T6 push routing', () => {
  it('push routing routes through the shared resolver', () => {
    const src = read('lib/routeNotification.ts');
    expect(src).toContain('resolvePushTarget');
    expect(src).not.toContain('DEEPLINK_ROUTES');
    expect(read('app/_layout.tsx')).not.toContain('DEEPLINK_ROUTES');
  });

  it('local reminders only read permission and carry the snooze category', () => {
    const src = read('hooks/useLocalReminders.ts');
    expect(src).not.toContain('requestPermissionsAsync');
    expect(src).toContain('categoryIdentifier');
  });
});
