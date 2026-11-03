import { formatQuietHours, passwordStrength } from './accountFormat';

describe('passwordStrength', () => {
  it('scores empty as 0 with no label', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });
  it('flags sub-8-char as too short', () => {
    expect(passwordStrength('abc')).toEqual({ score: 1, label: 'Too short' });
  });
  it('rewards length + variety toward strong', () => {
    expect(passwordStrength('Abcdefgh1!').score).toBeGreaterThanOrEqual(3);
  });
});

describe('formatQuietHours', () => {
  it('drops :00 and joins with an en dash', () => {
    expect(formatQuietHours('23:00', '08:00')).toBe('11 PM–8 AM');
    expect(formatQuietHours('23:30', '08:00')).toBe('11:30 PM–8 AM');
    expect(formatQuietHours(null, '08:00')).toBeNull();
  });
});
