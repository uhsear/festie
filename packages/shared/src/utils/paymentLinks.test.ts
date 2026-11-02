import { describe, it, expect } from 'vitest';
import { paymentProfileUrl } from './paymentLinks';

describe('paymentProfileUrl', () => {
  it('builds each profile URL and drops a leading @ or $', () => {
    expect(paymentProfileUrl('venmo', '@sam')).toBe('https://venmo.com/sam');
    expect(paymentProfileUrl('cashapp', '$sam')).toBe('https://cash.app/$sam');
    expect(paymentProfileUrl('paypal', 'sam')).toBe('https://www.paypal.com/paypalme/sam');
  });
  it('encodes unsafe characters', () => {
    expect(paymentProfileUrl('paypal', 'sam b')).toBe('https://www.paypal.com/paypalme/sam%20b');
  });
  it('returns null for an empty or blank handle', () => {
    expect(paymentProfileUrl('venmo', '')).toBeNull();
    expect(paymentProfileUrl('venmo', '  ')).toBeNull();
    expect(paymentProfileUrl('venmo', null)).toBeNull();
    expect(paymentProfileUrl('cashapp', '$')).toBeNull();
  });
});
