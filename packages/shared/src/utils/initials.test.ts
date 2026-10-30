import { describe, it, expect } from 'vitest';
import { displayInitials, identityLabel } from './initials';

describe('displayInitials', () => {
  it('prefers name over displayName and username', () => {
    expect(displayInitials({ name: 'Alice Brown', displayName: 'Zed', username: 'zzz' })).toBe('AB');
  });
  it('falls back to displayName then username', () => {
    expect(displayInitials({ name: null, displayName: 'Cara Diaz', username: 'zzz' })).toBe('CD');
    expect(displayInitials({ name: '  ', username: 'raver' })).toBe('R');
  });
  it('uses "User" when nothing is set', () => {
    expect(displayInitials(null)).toBe('U');
    expect(identityLabel({})).toBe('User');
  });
});
