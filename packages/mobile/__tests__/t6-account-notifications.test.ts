import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('T6 mobile notification settings', () => {
  const prefs = read('components/AccountNotificationPrefsSection.tsx');
  it('uses the shared rows and topics hook, and never dims rows', () => {
    expect(prefs).toContain('visibleNotificationRows');
    expect(prefs).toContain('useNotificationTopics');
    expect(prefs).not.toContain('opacity: 0.5');
  });
  it('opens system settings when permission is denied', () => {
    expect(read('components/AccountNotificationsSection.tsx')).toContain('Linking.openSettings');
  });
});
