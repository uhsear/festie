// Source-level guard: a per-festival switch must read OFF while its global switch is off.
import fs from 'node:fs';
import path from 'node:path';

describe('per-festival notification switch', () => {
  it('reflects the global-off state in value and accessibilityState', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components/AccountNotificationPrefsSection.tsx'), 'utf8');
    expect(src).toContain('value={!globalOff && subs[r.key]}');
    expect(src).toContain('checked: !globalOff && subs[r.key]');
  });
});
