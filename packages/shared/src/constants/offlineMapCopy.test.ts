import { describe, it, expect } from 'vitest';
import { OFFLINE_MAP_COPY } from './offlineMapCopy';

describe('offlineMapCopy', () => {
  it('notEnoughSpace leaves out the free size when it is unknown', () => {
    const msg = OFFLINE_MAP_COPY.notEnoughSpace(6_000_000, null);
    expect(msg).toContain('needs 6 MB)');
    expect(msg).not.toContain('free)');
    expect(msg).not.toContain('0 MB free');
  });

  it('notEnoughSpace states what is needed and what is free', () => {
    expect(OFFLINE_MAP_COPY.notEnoughSpace(190_000_000, 120_400_000)).toBe(
      'Not enough free space to save the map (needs 190 MB, 120 MB free). Free up some space and try again.',
    );
  });

  it('rounds needed up and free down', () => {
    expect(OFFLINE_MAP_COPY.notEnoughSpace(100_000_001, 99_999_999)).toContain('needs 101 MB, 99 MB free');
  });

  it('has a message for an unknown archive size', () => {
    expect(OFFLINE_MAP_COPY.notEnoughSpaceUnknownSize).toContain('Not enough free space');
  });

  it('siteplan note keeps the base map promise', () => {
    expect(OFFLINE_MAP_COPY.siteplanNeedsConnection).toContain('base map still works offline');
  });

  it('has a plain message for a failed download', () => {
    expect(OFFLINE_MAP_COPY.downloadFailed).toBe("Couldn't save the map. Check your connection and try again.");
  });
});
