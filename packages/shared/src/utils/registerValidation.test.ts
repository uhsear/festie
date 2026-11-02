import { describe, it, expect, afterAll } from 'vitest';
import { AUTH_COPY } from '../constants/authCopy';
import {
  REGISTER_COPY,
  firstInvalidField,
  isAtLeast18,
  validateRegister,
  type RegisterFields,
} from './registerValidation';

const NOW = new Date(2026, 9, 28);
const valid: RegisterFields = {
  username: 'alice',
  email: 'a@b.co',
  password: 'password123',
  confirmPassword: 'password123',
  dateOfBirth: '1995-01-01',
  tosAccepted: true,
};

describe('validateRegister', () => {
  it('accepts a complete form', () => {
    expect(validateRegister(valid, NOW)).toEqual({});
  });

  it('reports every missing field at once', () => {
    const errors = validateRegister(
      { username: '', email: '', password: '', confirmPassword: '', dateOfBirth: '', tosAccepted: false },
      NOW,
    );
    expect(Object.keys(errors).sort()).toEqual(['dateOfBirth', 'email', 'password', 'tosAccepted', 'username']);
    expect(errors.username).toBe(REGISTER_COPY.usernameRequired);
    expect(errors.email).toBe(AUTH_COPY.emailRequired);
    expect(errors.tosAccepted).toBe('Accept the Terms of Service and Privacy Policy to continue');
  });

  it('reports a mismatch only once the password itself is valid', () => {
    const short = validateRegister({ ...valid, password: 'short', confirmPassword: 'other' }, NOW);
    expect(short.password).toBe('Password must be at least 8 characters');
    expect(short.confirmPassword).toBeUndefined();
    const mismatch = validateRegister({ ...valid, confirmPassword: 'password124' }, NOW);
    expect(mismatch.password).toBeUndefined();
    expect(mismatch.confirmPassword).toBe('Passwords do not match');
  });

  it('trims the username and checks its shape', () => {
    expect(validateRegister({ ...valid, username: '  alice  ' }, NOW).username).toBeUndefined();
    expect(validateRegister({ ...valid, username: 'a' }, NOW).username).toBe(AUTH_COPY.usernameInvalid);
  });

  it('rejects a malformed email', () => {
    expect(validateRegister({ ...valid, email: 'nope' }, NOW).email).toBe(REGISTER_COPY.emailInvalid);
  });

  it('rejects under 18 and accepts exactly 18 today', () => {
    expect(isAtLeast18('2008-10-29', NOW)).toBe(false);
    expect(isAtLeast18('2008-10-28', NOW)).toBe(true);
    expect(validateRegister({ ...valid, dateOfBirth: '2015-01-01' }, NOW).dateOfBirth).toBe(REGISTER_COPY.under18);
  });

  it('rejects a malformed date', () => {
    expect(isAtLeast18('1995-1-1', NOW)).toBe(false);
  });
});

describe('firstInvalidField', () => {
  it('returns the earliest field in the given order', () => {
    expect(firstInvalidField({ tosAccepted: 'x', email: 'y' }, ['username', 'email', 'tosAccepted'])).toBe('email');
    expect(firstInvalidField({}, ['username'])).toBeUndefined();
  });
});

describe('isAtLeast18 uses the local calendar date in any zone', () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  for (const tz of ['Asia/Tokyo', 'America/Los_Angeles']) {
    it(`under ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date(2026, 9, 31, 0, 30);
      expect(isAtLeast18('2008-10-31', now)).toBe(true);
      expect(isAtLeast18('2008-11-01', now)).toBe(false);
    });
  }
});
