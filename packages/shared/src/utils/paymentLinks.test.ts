import { describe, it, expect } from 'vitest';
import { cashAppLink, payPalLink, paymentProfileUrl, venmoLink } from './paymentLinks';

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

describe('payment links', () => {
  it('PayPal ends in the amount and code for a non-USD currency', () => {
    expect(payPalLink({ handle: 'sam', amountCents: 1240, currency: 'EUR' })?.web).toBe(
      'https://www.paypal.com/paypalme/sam/12.40EUR',
    );
  });

  it('PayPal stays code-free for USD or no currency', () => {
    expect(payPalLink({ handle: 'sam', amountCents: 1240 })?.web).toMatch(/\/12\.40$/);
    expect(payPalLink({ handle: 'sam', amountCents: 1240, currency: 'USD' })?.web).toMatch(/\/12\.40$/);
  });

  it('keeps Venmo and Cash App unchanged', () => {
    expect(venmoLink({ handle: '@sam', amountCents: 500 })?.app).toContain('amount=5.00');
    expect(cashAppLink({ handle: '$sam', amountCents: 500 })?.web).toBe('https://cash.app/$sam/5.00');
  });
});
