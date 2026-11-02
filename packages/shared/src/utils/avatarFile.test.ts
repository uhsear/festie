import { describe, it, expect } from 'vitest';
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, validateAvatarFile } from './avatarFile';
import { AVATAR_COPY } from '../constants/accountSettings';

describe('validateAvatarFile', () => {
  it('rejects a file one byte over 5 MB', () => {
    expect(validateAvatarFile({ size: AVATAR_MAX_BYTES + 1, type: 'image/png' })).toBe(AVATAR_COPY.tooBig);
  });
  it('accepts exactly 5 MB', () => {
    expect(validateAvatarFile({ size: AVATAR_MAX_BYTES, type: 'image/png' })).toBeNull();
  });
  it('rejects an unsupported type', () => {
    expect(validateAvatarFile({ size: 10, type: 'image/heic' })).toBe(AVATAR_COPY.wrongType);
  });
  it('passes a file with no size or type', () => {
    expect(validateAvatarFile({})).toBeNull();
  });
  it('lists four accepted types', () => {
    expect(AVATAR_ACCEPT.split(',')).toHaveLength(4);
  });
});
