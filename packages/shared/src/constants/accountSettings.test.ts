import { describe, it, expect } from 'vitest';
import { ACCOUNT_SECTIONS, THEME_MODE_OPTIONS } from './accountSettings';

describe('ACCOUNT_SECTIONS', () => {
  it('has unique ids', () => {
    const ids = ACCOUNT_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('starts with the five agreed labels', () => {
    expect(ACCOUNT_SECTIONS.slice(0, 5).map((s) => s.label)).toEqual([
      'Account',
      'Notifications',
      'Privacy and sharing',
      'Offline and data',
      'Appearance and accessibility',
    ]);
  });
  it('marks only admin as adminOnly', () => {
    const adminOnly = ACCOUNT_SECTIONS.filter((s) => 'adminOnly' in s).map((s) => s.id);
    expect(adminOnly).toEqual(['admin']);
  });
});

describe('THEME_MODE_OPTIONS', () => {
  it('offers stage, daylight and system', () => {
    expect(THEME_MODE_OPTIONS.map((o) => o.value)).toEqual(['stage', 'daylight', 'system']);
  });
});
