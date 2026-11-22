import { describe, expect, it } from 'vitest';
import { read } from '../__tests__/read-source';

describe('notification prefs that failed to load', () => {
  it('offers a retry instead of default switches', () => {
    const src = read('components/AccountNotificationPrefsSection.tsx');
    expect(src).toContain('const loadFailed = !loaded && !!storeError');
    expect(src).toContain('if (loadFailed)');
    expect(src).toContain('label="Try again"');
  });
});
