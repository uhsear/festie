// The shared client copy of the password policy must match the server, which
// is the source of truth. The backend cannot import @festie/shared at runtime.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { COMMON_PASSWORDS as SERVER_COMMON, checkPasswordPolicy } from '../lib/helpers/validation.js';
import { COMMON_PASSWORDS as SHARED_COMMON, passwordPolicyError } from '../packages/shared/src/utils/passwordPolicy.js';

describe('password policy parity (server vs @festie/shared)', () => {
  test('the common-password sets are equal', () => {
    assert.deepEqual([...SHARED_COMMON].sort(), [...SERVER_COMMON].sort());
  });

  const cases: Array<[string, { username?: string | null; email?: string | null }?]> = [
    [''],
    ['short'],
    ['1234567'],
    ['12345678'],
    ['a'.repeat(100)],
    ['a'.repeat(101)],
    ['password123'],
    ['  Password123  '],
    ['FESTIVAL1'],
    ['festival-rules-ok'],
    ['correct horse battery'],
    ['alice-rocks-99', { username: 'alice' }],
    ['ALICE-rocks-99', { username: 'Alice ' }],
    ['al-rocks-99-xyz', { username: 'al' }],
    ['bobby-tables-1', { email: 'bobby@example.com' }],
    ['BOBBY-tables-1', { email: ' Bobby@example.com' }],
    ['jo-is-cool-123', { email: 'jo@example.com' }],
    ['nothing-matches', { username: 'carol', email: 'dave@example.com' }],
    ['carol-and-dave', { username: null, email: null }],
    ['dave-the-great', { username: 'carol', email: 'dave@example.com' }],
    ['qwerty123', { username: 'qwerty' }],
  ];

  for (const [value, ctx] of cases) {
    test(`same result for ${JSON.stringify(value.length > 20 ? `${value.slice(0, 10)}…(${value.length})` : value)} ${ctx ? JSON.stringify(ctx) : ''}`, () => {
      assert.equal(passwordPolicyError(value, ctx), checkPasswordPolicy(value, ctx));
    });
  }
});
