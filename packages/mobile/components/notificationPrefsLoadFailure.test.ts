import { describe, expect, it } from 'vitest';
import { read } from '../__tests__/read-source';

describe('notification prefs that failed to load', () => {
  it('offers a retry instead of default switches', () => {
    const src = read('components/AccountNotificationPrefsSection.tsx');
    expect(src).toContain('const loadFailed = !loaded && !!storeError');
    expect(src).toContain('if (loadFailed)');
    expect(src).toContain('label="Try again"');
  });

  it('renders festival rows only after the global prefs loaded', () => {
    const src = read('components/AccountNotificationPrefsSection.tsx');
    const early = src.slice(src.indexOf('if (showSkeleton)'), src.indexOf('const rows = visibleNotificationRows()'));
    expect(early).not.toContain('FestivalTopicsRows');
  });
});
