import { setReturnTo, takeReturnTo } from './returnTo';

describe('return path', () => {
  it('returns the stored path once, then null', () => {
    setReturnTo('/set/abc');
    expect(takeReturnTo()).toBe('/set/abc');
    expect(takeReturnTo()).toBeNull();
  });

  it('stores nothing for an unsafe path', () => {
    setReturnTo('//evil.com');
    expect(takeReturnTo()).toBeNull();
  });

  it('clears the value on null', () => {
    setReturnTo('/set/abc');
    setReturnTo(null);
    expect(takeReturnTo()).toBeNull();
  });
});
