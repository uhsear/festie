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
