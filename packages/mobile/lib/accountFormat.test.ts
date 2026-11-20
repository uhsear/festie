import { formatQuietHours } from './accountFormat';

describe('formatQuietHours', () => {
  it('drops :00 and joins with an en dash', () => {
    expect(formatQuietHours('23:00', '08:00')).toBe('11 PM–8 AM');
    expect(formatQuietHours('23:30', '08:00')).toBe('11:30 PM–8 AM');
    expect(formatQuietHours(null, '08:00')).toBeNull();
  });
});
