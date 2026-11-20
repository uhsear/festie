import { describe, it, expect } from 'vitest';
import { passwordPolicyError, passwordStrength, PASSWORD_RULES } from './passwordPolicy';

describe('passwordPolicyError', () => {
  it('requires a value', () => expect(passwordPolicyError('')).toBe('Password is required'));
  it.each([['1234567'.padEnd(7, 'x')]])('rejects length 7', (v) => {
    expect(passwordPolicyError(v)).toBe('Password must be at least 8 characters');
  });
  it('accepts 8 and 100, rejects 101', () => {
    expect(passwordPolicyError('qZ7!mK2p')).toBeNull();
    expect(passwordPolicyError('a'.repeat(100))).toBeNull();
    expect(passwordPolicyError('a'.repeat(101))).toBe('Password must be at most 100 characters');
  });
  it('rejects common passwords regardless of case and edge spaces', () => {
    const msg = 'That password is too common — please choose something harder to guess';
    expect(passwordPolicyError('festival1')).toBe(msg);
    expect(passwordPolicyError('  PassWord123 ')).toBe(msg);
  });
  it('rejects a username inside the password, ignoring a 2-letter username', () => {
    expect(passwordPolicyError('alice-rocks-99', { username: 'alice' })).toBe('Password must not contain your username');
    expect(passwordPolicyError('xjq-rocks-99', { username: 'jq' })).toBeNull();
  });
  it('rejects the email local part', () => {
    expect(passwordPolicyError('bobsmith-2026!', { email: 'BobSmith@x.co' })).toBe('Password must not contain your email address');
  });
  it('states the rules', () => expect(PASSWORD_RULES).toContain('8 to 100'));
});

describe('passwordStrength', () => {
  it('scores empty as 0 with no label', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });
  it('flags anything under 8 characters as too short', () => {
    expect(passwordStrength('abc')).toEqual({ score: 1, label: 'Too short' });
    expect(passwordStrength('Abcd1!x')).toEqual({ score: 1, label: 'Too short' });
  });
  it('steps weak, fair, good, strong with length and variety', () => {
    expect(passwordStrength('abcdefgh')).toEqual({ score: 1, label: 'Weak' });
    expect(passwordStrength('abcdefgh1234')).toEqual({ score: 3, label: 'Good' });
    expect(passwordStrength('Abcdefgh1!')).toEqual({ score: 4, label: 'Strong' });
  });
  it('caps a password the policy rejects instead of reading Good', () => {
    expect(passwordStrength('Password1')).toEqual({ score: 1, label: 'Too guessable' });
    expect(passwordStrength('Maria1234!', { username: 'maria' })).toEqual({ score: 1, label: 'Too guessable' });
    expect(passwordStrength('Maria1234!', { email: 'maria@example.com' })).toEqual({ score: 1, label: 'Too guessable' });
    expect(passwordStrength('Maria1234!', { username: 'sam' }).score).toBe(4);
  });
});
