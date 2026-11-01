import { describe, it, expect } from 'vitest';
import { usernameError, validateNewPassword, registerErrorField } from './authValidation';
import { AUTH_COPY } from '../constants/authCopy';

describe('usernameError', () => {
  it.each(['ab', 'dj-x_1 b', ' alice '])('accepts %j', (v) => {
    expect(usernameError(v)).toBeNull();
  });
  it.each(['a', 'a'.repeat(31), 'two  spaces', 'émile', 'a.b'])('rejects %j', (v) => {
    expect(usernameError(v)).toBe(AUTH_COPY.usernameInvalid);
  });
});

describe('validateNewPassword', () => {
  it('requires a password', () => {
    expect(validateNewPassword('', '')).toEqual({ password: 'Password is required' });
  });
  it('requires 8 characters', () => {
    expect(validateNewPassword('short', 'short')).toEqual({ password: 'Password must be at least 8 characters' });
  });
  it('requires a match', () => {
    expect(validateNewPassword('longenough', 'different')).toEqual({ confirmPassword: 'Passwords do not match' });
  });
  it('passes', () => {
    expect(validateNewPassword('longenough', 'longenough')).toEqual({});
  });
});

describe('registerErrorField', () => {
  it.each([
    ['Username already taken', 'username'],
    ['Username must be 2-30 characters (letters, numbers, spaces, hyphens, underscores)', 'username'],
    ['Email address already in use', 'email'],
    ['Password must not contain your username', 'password'],
    ['That password is too common — please choose something harder to guess', 'password'],
    ['Maximum users reached', null],
  ])('%s -> %s', (msg, field) => {
    expect(registerErrorField(msg)).toBe(field);
  });
});
