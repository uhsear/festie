import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { schemas, CREW_CURRENCIES } from '../lib/schemas.js';

const base = {
  username: 'testuser',
  password: 'Str0ngTest!Pw',
  confirmPassword: 'Str0ngTest!Pw',
  dateOfBirth: '1995-01-01',
  tosAccepted: true,
};

describe('FND-023: register requires an email', () => {
  it('rejects a missing email', () => {
    const r = schemas.register.safeParse(base);
    assert.equal(r.success, false);
  });

  for (const email of ['', '   ', 'not-an-email']) {
    it(`rejects ${JSON.stringify(email)}`, () => {
      assert.equal(schemas.register.safeParse({ ...base, email }).success, false);
    });
  }

  it('accepts a valid email and trims it', () => {
    const r = schemas.register.safeParse({ ...base, email: ' a@b.co ' });
    assert.equal(r.success, true);
    assert.equal(r.data?.email, 'a@b.co');
  });
});

describe('FND-082: USD is the only crew currency for new writes', () => {
  it('lists only USD', () => {
    assert.deepEqual([...CREW_CURRENCIES], ['USD']);
  });

  it('accepts USD', () => {
    assert.equal(schemas.expenseCurrency.safeParse({ currency: 'USD' }).success, true);
  });

  for (const currency of ['EUR', 'GBP', 'usd']) {
    it(`rejects ${currency}`, () => {
      assert.equal(schemas.expenseCurrency.safeParse({ currency }).success, false);
    });
  }
});
