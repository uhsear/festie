import { resolveApiOrigin } from './apiOrigin';

describe('resolveApiOrigin', () => {
  it('defaults to production', () => {
    expect(resolveApiOrigin(undefined)).toBe('https://festie.us');
    expect(resolveApiOrigin('  ')).toBe('https://festie.us');
  });

  it('uses the build-time origin without a trailing slash', () => {
    expect(resolveApiOrigin('http://10.0.2.2:4001/')).toBe('http://10.0.2.2:4001');
  });
});
