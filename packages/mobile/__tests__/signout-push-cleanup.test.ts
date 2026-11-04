// Source-level guards: sign-out must drop the push token before the session is revoked.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('sign-out push cleanup (source-level guards)', () => {
  it('unregisterPushOnSignOut deletes the token, clears keys and cancels reminders', () => {
    const src = read('hooks/useMobilePush.ts');
    const fn = src.slice(src.indexOf('export async function unregisterPushOnSignOut'), src.indexOf('Notifications.setNotificationHandler'));
    expect(fn).toContain("api.delete('/notifications/token'");
    expect(fn).toContain('multiRemove([TOKEN_KEY, LOCAL_FESTIVAL_KEY, LOCAL_COVERS_KEY])');
    expect(fn).toContain('cancelAllScheduledNotificationsAsync()');
  });

  it('handleLogout unregisters before logout() revokes the session', () => {
    const src = read('app/(tabs)/account.tsx');
    const body = src.slice(src.indexOf('const handleLogout'));
    expect(body.indexOf('await unregisterPushOnSignOut()')).toBeGreaterThan(-1);
    expect(body.indexOf('await unregisterPushOnSignOut()')).toBeLessThan(body.indexOf('await logout()'));
  });
});
