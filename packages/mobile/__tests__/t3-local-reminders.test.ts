// Source-level guards for the one-reminder-per-set server skip (T3 P2).
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('T3 local reminders report their festival (source-level guards)', () => {
  it('useLocalReminders reports the covered festival after reconcile', () => {
    expect(read('hooks/useLocalReminders.ts')).toContain('reportLocalRemindersFestival(');
  });

  it('a failed local schedule keeps the server push on', () => {
    const src = read('hooks/useLocalReminders.ts');
    expect(src).toContain('Promise<boolean>');
    expect(src).toContain('results.every(Boolean)');
    expect(src).toContain('soonestReminders(upcoming, MAX_LOCAL_REMINDERS)');
  });

  it('the 64 cap counts only upcoming reminders, not the merged map', () => {
    const src = read('hooks/useLocalReminders.ts');
    expect(src).toContain('upcoming.length <= MAX_LOCAL_REMINDERS');
    expect(src).not.toContain('Object.keys(merged).length');
  });

  it('useMobilePush re-registers a rotated token and derives the switch from permission + token', () => {
    const src = read('hooks/useMobilePush.ts');
    const fn = src.slice(src.indexOf('export async function reregisterRotatedToken'), src.indexOf('export async function unregisterPushOnSignOut'));
    expect(fn).toContain("api.post('/notifications/token'");
    expect(fn).toContain('if (!cached || cached === newToken) return');
    expect(src).toContain('Notifications.addPushTokenListener(');
    expect(fn).toContain('localRemindersFestivalId');
    expect(read('app/_layout.tsx')).toContain('usePushTokenRotation();');
    expect(src).toContain("setRegistered(p.status === 'granted' && !!token)");
  });

  it('useMobilePush clears the reported-festival key on register and unregister', () => {
    const src = read('hooks/useMobilePush.ts');
    expect(src).toContain("'festie-push-local-festival'");
    const register = src.slice(src.indexOf('const register = '), src.indexOf('const unregister = '));
    const unregister = src.slice(src.indexOf('const unregister = '));
    expect(register).toContain('removeItem(LOCAL_FESTIVAL_KEY)');
    expect(unregister).toContain('removeItem(LOCAL_FESTIVAL_KEY)');
  });
});
